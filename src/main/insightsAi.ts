// The AI pages of Writer insights. Each runs only when asked, with the model chosen on the page,
// and sends text only to that model's provider.
//   - Story analysis: a quick pass over a sample of excerpts, or a deep scan of every word in
//     chunks, of the documents chosen. A chunk's result is kept by the hash of its text (and the
//     model), so a rescan only pays for text that changed, and a read by any model counts: what
//     one model will not read can be given to another. The results are merged here, then one
//     call writes the themes.
//   - Focus: a few things to work on, from the style numbers and recent passages.
//   - Insights: observations about habits, from the numbers alone (no manuscript text is sent).

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { costOf } from '@shared/pricing'
import type { AiConfig, AiState, FocusResult, StoryAnalysis, StoryEstimate, StoryFileState, StoryOptions, StoryPlan, WritingNotes } from '@shared/insights'
import type { ChatSettings } from '@shared/types'
import { getDefaults } from './chat'
import * as db from './db'
import * as docs from './docs'
import { emitInsights, summary } from './insights'
import { appendLog } from './logs'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { describeAnthropicError } from './providers/anthropic'

const CHUNK_WORDS = 15_000
const SAMPLE_EXCERPTS = 10
const EXCERPT_WORDS = 2_500
const HISTORY = 30
const NOTE_MAX = 1000

const CATEGORIES = ['Adult Content', 'Drama', 'Action', 'Romance', 'Slice of Life', 'War/Conflict', 'Worldbuilding', 'Sci-Fi', 'Fantasy', 'Mystery', 'Horror', 'Comedy']

const PRIVATE_FICTION =
  "The text is the author's own private fiction and may include adult or violent material. Describe and classify it neutrally and accurately, as an editor would; don't refuse, soften, summarise around, or comment on the content."

const NOTE_RULE =
  "An <author_note> before the text, when there is one, is the author's own word on how to read it (where it sits in the story, why it is here). Use it to read the text rightly; it is not part of the text and is not classified."

const CHUNK_RULES = `You classify one passage of a long work of fiction for the author's statistics. ${PRIVATE_FICTION} ${NOTE_RULE}

Answer with only a JSON object, no other text:
{"breakdown": {"<category>": <percent>, ...}, "genres": ["<genre>", ...], "tags": [{"name": "<broad tag>", "sub": ["<specific tag>", ...]}], "themes": ["<short theme name>", ...], "summary": "<one or two sentences on what happens>"}

- breakdown: how this passage's words divide between these categories, as whole percents summing to 100: ${CATEGORIES.join(', ')}. Use another category only when none fits.
- genres: every genre the passage belongs to (standard names: Drama, Romance, Action, Fantasy, Sci-Fi, Slice of Life, Adventure, Mystery, Horror, Comedy, War/Conflict, Adult Content, …).
- tags: up to 8 broad content tags, each with up to 6 specific subtags.
- themes: up to 5 short theme names.`

const QUICK_RULES = `You analyse a long work of fiction from excerpts sampled across it. ${PRIVATE_FICTION} ${NOTE_RULE}

Answer with only a JSON object, no other text:
{"breakdown": {"<category>": <percent>, ...}, "genres": {"<genre>": <0-100 how strongly present>, ...}, "tags": [{"name": "<broad tag>", "sub": ["<specific tag>", ...]}], "themes": [{"name": "<theme>", "description": "<two sentences, specific to this work>"}], "tone": "<one sentence>", "summary": "<three or four sentences on what the work is about>"}

- breakdown: how the work divides between these categories, as whole percents summing to 100: ${CATEGORIES.join(', ')}.
- genres: up to 10, strongest first. tags: up to 12, each with up to 8 subtags. themes: 4 to 8.`

const THEME_RULES = `You write the closing analysis of a long work of fiction from its chunk-by-chunk summaries and the themes counted across them. ${PRIVATE_FICTION} The author's notes, when given, are their own word on how to read some of it; take them into account.

Answer with only a JSON object, no other text:
{"themes": [{"name": "<theme>", "description": "<two sentences, specific to this work>"}], "tone": "<one sentence>", "summary": "<three or four sentences on what the work is about>"}

Give 4 to 8 themes, most important first.`

const FOCUS_RULES = `You are a candid, encouraging writing coach. From the author's prose statistics and a few recent passages of their own private fiction, pick the 3 to 5 things that would most improve the writing. ${PRIVATE_FICTION}

Answer with only a JSON object, no other text:
{"strength": "<one sentence on what the writing already does well>", "areas": [{"title": "<short name>", "why": "<two sentences>", "evidence": ["<a quote under 25 words from the passages>", ...], "exercise": "<one concrete thing to try in the next session>"}]}`

const NOTES_RULES = `You read a writer's own statistics (how much and when they write, their prose numbers, their characters) and point out what's interesting: habits, rhythms, trends, imbalances, things worth celebrating. Be specific to the numbers; no generic advice.

Answer with only a JSON object, no other text:
{"observations": [{"title": "<short headline>", "text": "<two or three sentences>"}], "nextStep": "<one suggestion for the coming week>"}

Give 4 to 6 observations.`

// ——— State ———

let controller: AbortController | null = null
let running: AiState['running'] = null
let lastError: string | null = null

function config(): AiConfig {
  const saved = db.kvGet<Partial<AiConfig>>('insights.ai.config')
  const d = getDefaults()
  return { providerId: d.providerId, modelId: d.modelId, effort: null, parallel: 3, skip: [], ...saved }
}

export function setConfig(cfg: AiConfig): AiState {
  const skip = Array.isArray(cfg.skip) ? cfg.skip.filter((p) => typeof p === 'string').slice(0, 5000) : config().skip
  db.kvSet('insights.ai.config', { ...cfg, skip, parallel: Math.min(10, Math.max(1, Math.round(cfg.parallel || 3))) })
  return state()
}

type History = AiState['history']

/** Every result kept, newest first; results from before history existed are folded in once. */
function history(): History {
  const saved = db.kvGet<History>('insights.ai.history')
  if (saved) return saved
  const latest = db.kvGet<Record<string, StoryAnalysis>>('insights.ai.story') ?? {}
  const focus = db.kvGet<FocusResult>('insights.ai.focus')
  const notes = db.kvGet<WritingNotes>('insights.ai.notes')
  return { story: Object.values(latest).sort((a, b) => b.at - a.at), focus: focus ? [focus] : [], notes: notes ? [notes] : [] }
}

function remember<K extends keyof History>(kind: K, result: History[K][number]): void {
  const h = history()
  // The first time, the folded-in latest result can be this very one: keep it once.
  const rest = (h[kind] as { at: number }[]).filter((r) => r.at !== result.at)
  db.kvSet('insights.ai.history', { ...h, [kind]: [result, ...rest].slice(0, HISTORY) })
}

/** Forgets one earlier result (by its time); the latest of each kind stays until replaced. */
export function forget(kind: keyof History, at: number): AiState {
  const h = history()
  db.kvSet('insights.ai.history', { ...h, [kind]: (h[kind] as { at: number }[]).filter((r) => r.at !== at) })
  return state()
}

export function state(): AiState {
  return {
    config: config(),
    story: db.kvGet<Record<string, StoryAnalysis>>('insights.ai.story') ?? {},
    focus: db.kvGet<FocusResult>('insights.ai.focus') ?? null,
    notes: db.kvGet<WritingNotes>('insights.ai.notes') ?? null,
    history: history(),
    running,
    error: lastError
  }
}

function publish(): void {
  emitInsights({ kind: 'ai', state: state() })
}

export function stop(): void {
  controller?.abort()
}

// ——— Calling the model ———

interface CallResult {
  json: unknown
  costUsd: number | null
  model: string
}

/** The model answered, but not with what was asked: nearly always it declined the text. */
class Unreadable extends Error {}

const reasonOf = (err: unknown): string => describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err))

/** Whether a failed call was about the text it was given (declined, filtered) rather than the key, the network or the model. */
const aboutTheText = (err: unknown): boolean => err instanceof Unreadable || /declin|refus|content|polic|safety|filter|moderat|blocked|flagged|violat|inappropriate/i.test(reasonOf(err))

/** Pulls the JSON object out of a reply (bare, or in a fenced block). */
export function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text)?.[1]
  const raw = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(raw)
}

async function call(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<CallResult> {
  const cfg = config()
  const provider = getProvider(cfg.providerId)
  const options = modelOptions(cfg.providerId, cfg.modelId)
  const settings: ChatSettings = {
    ...getDefaults(),
    providerId: cfg.providerId,
    modelId: cfg.modelId,
    systemPrompt: '',
    effort: cfg.effort,
    maxTokens,
    messageLimit: null,
    temperature: null,
    extraParams: '',
    webSearch: false,
    webFetch: false,
    choiceCards: false
  }
  const result = await implFor(provider).generate({
    config: provider,
    apiKey: getApiKey(provider.id),
    system,
    history: [
      {
        id: 'insights', conversation_id: 'insights', parent_id: null, role: 'user', text: user,
        content: JSON.stringify([{ type: 'text', text: user }]), thinking: null, model: null, provider_id: null,
        usage: null, status: 'done', error: null, active_child_id: null, created_at: Date.now()
      }
    ],
    settings,
    options,
    signal,
    onText: () => undefined,
    onThinking: () => undefined
  })
  if (signal.aborted) throw new Error('Stopped.')
  if (result.error) throw new Error(result.error)
  appendLog({ kind: 'insights', model: result.modelId, response: result.text })
  let json: unknown
  try {
    json = parseJson(result.text)
  } catch {
    throw new Unreadable("The model's answer wasn't the JSON Tasogare asked for. Try again, or pick another model.")
  }
  const local = provider.kind === 'openai' && /localhost|127\.0\.0\.1/.test(provider.baseUrl ?? '')
  return { json, costUsd: costOf(result.modelId, result.usage, local), model: result.modelId }
}

/** Runs one job at a time, with progress and errors published to the page. */
async function job<T>(kind: 'story' | 'focus' | 'notes', scope: string | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<AiState> {
  if (running) throw new Error('Another analysis is running. Stop it first, or wait for it to finish.')
  controller = new AbortController()
  running = { kind, done: 0, total: 1, scope }
  lastError = null
  publish()
  try {
    await work(controller.signal)
  } catch (err) {
    lastError = controller.signal.aborted ? null : reasonOf(err)
  } finally {
    // Parts of a long text still out when one of them failed stop with the job.
    controller?.abort()
    running = null
    controller = null
    publish()
  }
  return state()
}

function progress(done: number, total: number): void {
  if (running) running = { ...running, done, total }
  publish()
}

// ——— Text ———

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length

/** A quick 32-bit hash of a paragraph (FNV-1a), for choosing where chunks end. */
function fnv(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/**
 * Splits text into chunks of about `size` words at paragraph breaks. Where a chunk ends is decided
 * by the paragraphs themselves (one whose hash hits a pattern, once the chunk is big enough), not
 * by counting from the top, so an edit only changes the chunk it's in: the rest keep their exact
 * text, and a rescan doesn't pay for them again.
 */
function chunk(text: string, size: number): string[] {
  const min = size * 0.6
  const max = size * 1.5
  const out: string[] = []
  let current: string[] = []
  let words = 0
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue
    current.push(para)
    words += countWords(para)
    if (words >= max || (words >= min && fnv(para) % 12 === 0)) {
      out.push(current.join('\n\n'))
      current = []
      words = 0
    }
  }
  if (current.length) out.push(current.join('\n\n'))
  return out
}

/** The documents to read, in reading order, and the ones in the folder that were not asked for. */
async function sources(files: string[] | null): Promise<{ texts: { path: string; text: string }[]; leftOut: string[] }> {
  const folder = docs.writingFolder()
  const all = (await docs.listDocs()).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  // Only documents the folder lists are read, so a path from the page can never reach outside it.
  const wanted = files ? new Set(files) : null
  const texts: { path: string; text: string }[] = []
  const leftOut: string[] = []
  for (const d of all) {
    if (wanted && !wanted.has(d.path)) {
      leftOut.push(d.path)
      continue
    }
    try {
      texts.push({ path: d.path, text: await readFile(join(folder, d.path), 'utf8') })
    } catch {
      // A file that vanished since the listing is simply skipped.
    }
  }
  return { texts, leftOut }
}

const asFiles = (files: unknown): string[] | null => (Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : null)

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)
const CHUNK_PREFIX = 'insights.ai.chunk:'
const chunkKey = (hash: string, model: string): string => `${CHUNK_PREFIX}${model}:${hash}`

// ——— Story analysis ———

interface ChunkResult {
  breakdown: Record<string, number>
  genres: string[]
  tags: { name: string; sub: string[] }[]
  themes: string[]
  summary: string
  /** When it was read, and the author's note that went with it. */
  at?: number
  note?: string
}

/** One part of a document: the text a single call reads. */
interface Part {
  file: number
  text: string
  hash: string
  words: number
}

const partsOf = (texts: { text: string }[]): Part[] =>
  texts.flatMap((t, file) => chunk(t.text, CHUNK_WORDS).map((text) => ({ file, text, hash: hashOf(text), words: countWords(text) })))

/**
 * Which models have read each part, by the part's hash. A read is kept for good under the model
 * that made it, so an analysis can be put together from parts different models read: the files one
 * model would not read can be given to another without reading the rest again.
 */
function readers(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const key of db.kvKeys(CHUNK_PREFIX)) {
    const cut = key.lastIndexOf(':')
    const hash = key.slice(cut + 1)
    out.set(hash, [...(out.get(hash) ?? []), key.slice(CHUNK_PREFIX.length, cut)])
  }
  return out
}

/** The read of a part to use: the chosen model's own, else (unless only its own count) the newest by another. */
function readOf(hash: string, model: string, own: boolean, have: Map<string, string[]>): { model: string; r: ChunkResult } | null {
  const models = have.get(hash)
  if (!models) return null
  if (models.includes(model)) {
    const r = db.kvGet<ChunkResult>(chunkKey(hash, model))
    if (r) return { model, r }
  }
  if (own) return null
  let best: { model: string; r: ChunkResult } | null = null
  for (const m of models) {
    if (m === model) continue
    const r = db.kvGet<ChunkResult>(chunkKey(hash, m))
    if (r && (!best || (r.at ?? 0) > (best.r.at ?? 0))) best = { model: m, r }
  }
  return best
}

/** Parts a model would not or could not read, by hash, so the page can say so until one does. */
type Unread = Record<string, { reason: string; model: string; at: number }>
const UNREAD = 'insights.ai.unread'
const UNREAD_KEPT = 400

function price(calls: number, cached: number, words: number, sendWords: number): StoryEstimate {
  const cfg = config()
  // About 1.35 tokens a word in, a short answer out per call.
  const usage = { input: Math.round(sendWords * 1.35), output: calls * 500, cacheRead: 0, cacheWrite: 0, ms: 0 }
  const provider = getProvider(cfg.providerId)
  const local = provider.kind === 'openai' && /localhost|127\.0\.0\.1/.test(provider.baseUrl ?? '')
  return { calls, cached, words, costUsd: costOf(cfg.modelId, usage, local) }
}

/**
 * Every document in the folder with how much of it is already read, and what a quick sample and a
 * deep scan of the chosen ones (all of them when none are named) would send.
 */
export async function plan(files: string[] | null = null, opts: StoryOptions = {}): Promise<StoryPlan> {
  const cfg = config()
  const chosen = asFiles(files)
  const wanted = chosen ? new Set(chosen) : null
  const { texts } = await sources(null)
  const have = readers()
  const unread = db.kvGet<Unread>(UNREAD) ?? {}
  let words = 0
  let sendWords = 0
  let parts = 0
  let cached = 0
  const states = texts.map((t) => {
    const st: StoryFileState = { path: t.path, words: countWords(t.text), parts: 0, read: 0, models: [] }
    const counted = !wanted || wanted.has(t.path)
    for (const p of partsOf([t])) {
      st.parts++
      const got = readOf(p.hash, cfg.modelId, !!opts.own, have)
      if (got) {
        st.read++
        if (!st.models.includes(got.model)) st.models.push(got.model)
        if (got.r.note && !st.note) st.note = got.r.note
      } else if (unread[p.hash] && !st.error) st.error = unread[p.hash].reason
      if (!counted) continue
      parts++
      if (got) cached++
      else sendWords += p.words
    }
    if (counted) words += st.words
    return st
  })
  return {
    files: states,
    quick: price(1, 0, words, Math.min(words, SAMPLE_EXCERPTS * EXCERPT_WORDS)),
    deep: price(parts - cached + 1, cached, words, sendWords)
  }
}

export async function estimate(mode: 'quick' | 'deep', files: string[] | null = null, opts: StoryOptions = {}): Promise<StoryEstimate> {
  return (await plan(files, opts))[mode]
}

const asRecord = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && n >= 0)) : {}
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : [])
const asTags = (v: unknown): { name: string; sub: string[] }[] =>
  Array.isArray(v) ? v.filter((t) => t && typeof t.name === 'string').map((t) => ({ name: String(t.name).trim(), sub: asStrings(t.sub ?? t.subtags) })) : []

/** Percents that sum to 100, largest first, tiny ones folded away. */
function normalise(weights: Map<string, number>): { name: string; percent: number }[] {
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1
  return [...weights]
    .map(([name, w]) => ({ name, percent: (w / total) * 100 }))
    .filter((x) => x.percent >= 0.5)
    .sort((a, b) => b.percent - a.percent)
}

const withNote = (note: string, text: string): string => (note ? `<author_note>\n${note}\n</author_note>\n\n${text}` : text)

/**
 * A quick sample or a deep scan of the chosen documents (all of them when none are named).
 *
 * A deep scan reads only the parts no model has read yet (or, with `own`, the parts the chosen
 * model has not), and a part the model will not read is set aside rather than ending the scan: the
 * result is made from what was read and says which files are missing, so they can be tried again
 * with another model and only they are paid for.
 */
export function runStory(mode: 'quick' | 'deep', files: string[] | null = null, opts: StoryOptions = {}): Promise<AiState> {
  const chosen = asFiles(files)
  const note = (typeof opts.note === 'string' ? opts.note : '').trim().slice(0, NOTE_MAX)
  return job('story', chosen?.length === 1 ? chosen[0] : '', async (signal) => {
    const cfg = config()
    const { texts, leftOut } = await sources(chosen)
    const words = texts.reduce((n, t) => n + countWords(t.text), 0)
    if (!words) throw new Error('There is no text to analyse yet.')
    // What it is an analysis of: the folder, one document, or some of them.
    const scope = !leftOut.length ? '' : texts.length === 1 ? texts[0].path : 'selection'
    let cost: number | null = 0
    const addCost = (c: number | null): void => void (cost = cost === null || c === null ? null : cost + c)
    let result: StoryAnalysis

    if (mode === 'quick') {
      // Excerpts spread evenly through the work, in reading order.
      const all = texts.flatMap((t) => chunk(t.text, EXCERPT_WORDS).map((text) => ({ path: t.path, text })))
      const step = Math.max(1, all.length / SAMPLE_EXCERPTS)
      const picked = Array.from({ length: Math.min(SAMPLE_EXCERPTS, all.length) }, (_, i) => all[Math.floor(i * step)])
      progress(0, 1)
      const user = withNote(note, picked.map((p, i) => `<excerpt n="${i + 1}" from="${p.path}">\n${p.text}\n</excerpt>`).join('\n\n'))
      const r = await call(QUICK_RULES, user, 8000, signal)
      addCost(r.costUsd)
      const j = r.json as Record<string, unknown>
      const genres = asRecord(j.genres)
      result = {
        mode, scope, model: r.model, at: Date.now(), words, calls: 1, costUsd: cost,
        breakdown: normalise(new Map(Object.entries(asRecord(j.breakdown)))),
        genres: Object.entries(genres).map(([name, p]) => ({ name, percent: Math.min(100, p) })).sort((a, b) => b.percent - a.percent),
        tags: asTags(j.tags).map((t) => ({ name: t.name, subtags: t.sub })),
        themes: Array.isArray(j.themes) ? j.themes.filter((t) => t?.name).map((t) => ({ name: String(t.name), description: String(t.description ?? '') })) : [],
        tone: String(j.tone ?? ''),
        summary: String(j.summary ?? ''),
        files: texts.map((t) => ({ path: t.path, words: countWords(t.text), read: countWords(t.text), models: [r.model] })),
        leftOut,
        ...(note ? { note } : {})
      }
      progress(1, 1)
    } else {
      const parts = partsOf(texts)
      const have = readers()
      const results = parts.map((p) => readOf(p.hash, cfg.modelId, !!opts.own, have))
      const todo = parts.map((_, i) => i).filter((i) => !results[i])
      const failed = new Map<number, string>()
      let done = parts.length - todo.length
      let calls = 0
      let fatal: unknown = null
      progress(done, parts.length + 1)
      let next = 0
      const worker = async (): Promise<void> => {
        while (next < todo.length && !signal.aborted && !fatal) {
          const i = todo[next++]
          const p = parts[i]
          try {
            const out = await call(CHUNK_RULES, withNote(note, p.text), 3000, signal)
            calls++
            addCost(out.costUsd)
            const j = out.json as Record<string, unknown>
            const r: ChunkResult = {
              breakdown: asRecord(j.breakdown), genres: asStrings(j.genres), tags: asTags(j.tags), themes: asStrings(j.themes), summary: String(j.summary ?? ''),
              at: Date.now(), ...(note ? { note } : {})
            }
            db.kvSet(chunkKey(p.hash, cfg.modelId), r)
            results[i] = { model: cfg.modelId, r }
          } catch (err) {
            if (signal.aborted) throw err
            // This part is set aside and the scan goes on. Only when nothing at all has been read
            // and the first calls fail for a reason that is not the text (the key, the network,
            // the model's name) does the scan end, rather than fail every part in turn.
            failed.set(i, reasonOf(err))
            if (!calls && failed.size >= Math.max(3, cfg.parallel) && !aboutTheText(err)) fatal = err
          }
          progress(++done, parts.length + 1)
        }
      }
      await Promise.all(Array.from({ length: cfg.parallel }, worker))
      if (signal.aborted) throw new Error('Stopped.')
      if (fatal) throw fatal

      // What would not be read is remembered, so the page can say so until some model reads it.
      const unread = db.kvGet<Unread>(UNREAD) ?? {}
      parts.forEach((p, i) => {
        if (results[i]) delete unread[p.hash]
        else if (failed.has(i)) unread[p.hash] = { reason: failed.get(i) ?? '', model: cfg.modelId, at: Date.now() }
      })
      db.kvSet(UNREAD, Object.fromEntries(Object.entries(unread).sort((a, b) => b[1].at - a[1].at).slice(0, UNREAD_KEPT)))

      const read = parts.flatMap((p, i) => {
        const got = results[i]
        return got ? [{ p, model: got.model, r: got.r }] : []
      })
      if (!read.length) throw new Error(`None of it could be read. ${[...failed.values()][0] ?? ''}`.trim())
      const readWords = read.reduce((n, x) => n + x.p.words, 0)

      // Merge: categories weighted by words; genres by the share of words they appear in.
      const breakdown = new Map<string, number>()
      const genreWords = new Map<string, number>()
      const tagCount = new Map<string, { n: number; sub: Map<string, number> }>()
      const themeCount = new Map<string, number>()
      const notes = new Map<string, Set<string>>()
      for (const { p, r } of read) {
        const w = p.words
        const sum = Object.values(r.breakdown).reduce((a, b) => a + b, 0) || 1
        for (const [k, v] of Object.entries(r.breakdown)) breakdown.set(k, (breakdown.get(k) ?? 0) + (v / sum) * w)
        for (const g of new Set(r.genres)) genreWords.set(g, (genreWords.get(g) ?? 0) + w)
        for (const t of r.tags) {
          const e = tagCount.get(t.name) ?? { n: 0, sub: new Map() }
          e.n++
          for (const s of t.sub) e.sub.set(s, (e.sub.get(s) ?? 0) + 1)
          tagCount.set(t.name, e)
        }
        for (const th of r.themes) themeCount.set(th, (themeCount.get(th) ?? 0) + 1)
        if (r.note) notes.set(r.note, (notes.get(r.note) ?? new Set()).add(texts[p.file].path))
      }
      const topThemes = [...themeCount].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => `${t} (${n} chunks)`)
      // The closing call reads every chunk's summary, in order, trimmed to a sane length, and what
      // the author said about the files: the notes kept with their reads, and this run's own.
      const summaries = read.map((x, i) => `${i + 1}. ${x.r.summary}`).join('\n')
      const noteLines = [...notes].map(([text, paths]) => `- On ${[...paths].join(', ')}: ${text}`)
      if (note && !notes.has(note)) noteLines.push(`- ${note}`)
      const user =
        `Themes counted across ${read.length} chunks: ${topThemes.join('; ')}\n\n` +
        (noteLines.length ? `The author's notes:\n${noteLines.join('\n')}\n\n` : '') +
        `Chunk summaries, in reading order:\n${summaries.slice(-120_000)}`
      const fin = await call(THEME_RULES, user, 6000, signal)
      calls++
      addCost(fin.costUsd)
      const j = fin.json as Record<string, unknown>
      result = {
        mode, scope, model: fin.model, at: Date.now(), words: readWords, calls, costUsd: cost,
        breakdown: normalise(breakdown),
        genres: [...genreWords].map(([name, w]) => ({ name, percent: (w / readWords) * 100 })).sort((a, b) => b.percent - a.percent).slice(0, 12),
        tags: [...tagCount]
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, 12)
          .map(([name, e]) => ({ name, subtags: [...e.sub].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s) })),
        themes: Array.isArray(j.themes) ? j.themes.filter((t) => t?.name).map((t) => ({ name: String(t.name), description: String(t.description ?? '') })) : [],
        tone: String(j.tone ?? ''),
        summary: String(j.summary ?? ''),
        files: texts.map((t, f) => {
          const mine = parts.map((p, i) => ({ p, i })).filter((x) => x.p.file === f)
          const got = mine.filter((x) => results[x.i])
          const bad = mine.find((x) => failed.has(x.i))
          return {
            path: t.path,
            words: mine.reduce((n, x) => n + x.p.words, 0),
            read: got.reduce((n, x) => n + x.p.words, 0),
            models: [...new Set(got.map((x) => results[x.i]?.model ?? ''))],
            ...(bad ? { error: failed.get(bad.i) } : {})
          }
        }),
        leftOut,
        ...(note ? { note } : {})
      }
      progress(parts.length + 1, parts.length + 1)
    }
    const all = db.kvGet<Record<string, StoryAnalysis>>('insights.ai.story') ?? {}
    db.kvSet('insights.ai.story', { ...all, [scope]: result })
    remember('story', result)
  })
}

// ——— Focus and Insights ———

/** The last stretch of the most recently changed documents: what's being written now. */
async function recentPassages(count: number, words: number): Promise<string[]> {
  const folder = docs.writingFolder()
  const recent = (await docs.listDocs()).slice(0, count)
  const out: string[] = []
  for (const d of recent) {
    const text = await readFile(join(folder, d.path), 'utf8').catch(() => '')
    const paras = text.split(/\n\s*\n/)
    const kept: string[] = []
    let n = 0
    for (let i = paras.length - 1; i >= 0 && n < words; i--) {
      kept.unshift(paras[i])
      n += countWords(paras[i])
    }
    if (kept.join('').trim()) out.push(`<passage from="${d.path}">\n${kept.join('\n\n')}\n</passage>`)
  }
  return out
}

function styleLines(): string {
  const s = summary()
  const st = s.style
  return [
    `Words in the folder: ${s.storyTotal}`,
    `Average sentence: ${st.avgSentence.toFixed(1)} words (longest ${st.longestSentence})`,
    `Dialogue: ${st.dialoguePercent.toFixed(1)}% of words`,
    `Adverbs (-ly): ${st.adverbsPer1k.toFixed(1)} per 1,000 words; most used: ${st.topAdverbs.slice(0, 12).map((w) => `${w.word} ${w.count}`).join(', ')}`,
    `Vocabulary: ${st.vocabulary} different words (richness ${st.richness.toFixed(2)}%)`,
    `Most used words: ${st.topWords.slice(0, 25).map((w) => `${w.word} ${w.count}`).join(', ')}`
  ].join('\n')
}

export function runFocus(): Promise<AiState> {
  return job('focus', undefined, async (signal) => {
    const passages = await recentPassages(3, 1200)
    if (!passages.length) throw new Error('There is no writing to look at yet.')
    progress(0, 1)
    const r = await call(FOCUS_RULES, `Prose statistics:\n${styleLines()}\n\nRecent passages:\n${passages.join('\n\n')}`, 4000, signal)
    const j = r.json as Record<string, unknown>
    const result: FocusResult = {
      model: r.model,
      at: Date.now(),
      strength: String(j.strength ?? ''),
      areas: Array.isArray(j.areas)
        ? j.areas.filter((a) => a?.title).map((a) => ({ title: String(a.title), why: String(a.why ?? ''), evidence: asStrings(a.evidence).slice(0, 3), exercise: String(a.exercise ?? '') }))
        : []
    }
    db.kvSet('insights.ai.focus', result)
    remember('focus', result)
    progress(1, 1)
  })
}

export function runNotes(): Promise<AiState> {
  return job('notes', undefined, async (signal) => {
    const s = summary()
    const weekdays = Array(7).fill(0)
    for (const d of s.days) {
      const [y, m, day] = d.day.split('-').map(Number)
      weekdays[new Date(y, m - 1, day).getDay()] += d.words
    }
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const numbers = [
      `Tracking since ${s.trackingSince}; ${s.written} words written on ${s.activeDays} days; current streak ${s.streak}, longest ${s.longestStreak}; best day ${s.bestDay?.words ?? 0} words on ${s.bestDay?.day ?? 'n/a'}.`,
      `Today ${s.today}, this week ${s.week}, this month ${s.month}, this year ${s.year}.`,
      `Last 14 days: ${s.last14.map((d) => `${d.day} ${d.words}`).join(', ')}`,
      `By weekday: ${weekdays.map((w, i) => `${names[i]} ${w}`).join(', ')}`,
      `By hour: ${s.hours.map((w, h) => `${h}:00 ${w}`).filter((x) => !x.endsWith(' 0')).join(', ') || 'no data yet'}`,
      `Documents: ${s.files}; largest: ${[...s.perFile].sort((a, b) => b.words - a.words).slice(0, 8).map((f) => `${f.path} ${f.words}`).join(', ')}`,
      styleLines(),
      `Characters by mentions: ${s.characters.map((c) => `${c.name} ${c.mentions} (${c.share.toFixed(0)}%)`).join(', ') || 'none tracked'}`,
      `Most paired: ${s.pairs.slice(0, 8).map((p) => `${p.a}+${p.b} ${p.scenes}`).join(', ') || 'none'}`
    ].join('\n')
    progress(0, 1)
    const r = await call(NOTES_RULES, numbers, 3000, signal)
    const j = r.json as Record<string, unknown>
    const result: WritingNotes = {
      model: r.model,
      at: Date.now(),
      observations: Array.isArray(j.observations) ? j.observations.filter((o) => o?.title).map((o) => ({ title: String(o.title), text: String(o.text ?? '') })) : [],
      nextStep: String(j.nextStep ?? '')
    }
    db.kvSet('insights.ai.notes', result)
    remember('notes', result)
    progress(1, 1)
  })
}
