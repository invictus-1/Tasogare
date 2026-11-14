// Fresh battles (see @shared/battle): two models write from one setup with no chat behind them,
// as many passes as wanted, and the Judge compares each pass. The writing happens here: a side's
// turns are streamed like a reply, and everything is kept in the database as it goes, so a battle
// survives a restart.

import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONTINUE, MAX_PASSES, passageOf, passReady, sideWriting, type Battle, type BattleSetup, type BattleSide, type BattleSummary, type BattleTurn, type BattleView, type BattleWriter } from '@shared/battle'
import type { JudgeInput } from '@shared/judge'
import type { ChatSettings, StreamEvent } from '@shared/types'
import { getDefaults } from './chat'
import * as db from './db'
import * as judge from './judge'
import { appendLog } from './logs'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { describeAnthropicError } from './providers/anthropic'

// ——— Storage ———

/** What is writing now, by "<battle>:<pass>:<side>". */
const running = new Map<string, AbortController>()
const slotOf = (id: string, pass: number, side: number): string => `${id}:${pass}:${side}`

function load(id: string): Battle | undefined {
  const b = db.kvGet<Battle>(`battle:${id}`)
  if (!b) return undefined
  // A turn still "streaming" with nothing writing it was cut short by a close; it never finishes.
  b.passes.forEach((pass, p) =>
    pass.sides.forEach((side, s) => {
      if (running.has(slotOf(id, p, s))) return
      for (const t of side.turns)
        if (t.status === 'streaming') {
          t.status = 'stopped'
          t.error ??= 'Tasogare closed before this finished.'
        }
    })
  )
  return b
}

function save(b: Battle): void {
  db.kvSet(`battle:${b.id}`, b)
  const index = (db.kvGet<string[]>('battles') ?? []).filter((x) => x !== b.id)
  index.unshift(b.id)
  db.kvSet('battles', index)
}

function need(id: string): Battle {
  const b = load(id)
  if (!b) throw new Error('That battle no longer exists.')
  return b
}

function sideOf(b: Battle, pass: number, side: number): BattleSide {
  const found = b.passes[pass]?.sides[side]
  if (!found) throw new Error('That pass is not part of this battle.')
  return found
}

function view(b: Battle): BattleView {
  return {
    battle: b,
    judgments: b.passes.map((p) => {
      if (!p.judgmentId) return null
      try {
        return judge.getJudgment(p.judgmentId)
      } catch {
        // Deleted from the list of comparisons: the pass counts as not judged.
        return null
      }
    })
  }
}

export function getBattle(id: string): BattleView {
  return view(need(id))
}

export function listBattles(): BattleSummary[] {
  return (db.kvGet<string[]>('battles') ?? [])
    .map(load)
    .filter((b): b is Battle => !!b)
    .map((b) => ({
      id: b.id,
      title: b.setup.title || 'Untitled battle',
      createdAt: b.createdAt,
      passes: b.passes.length,
      judged: b.passes.filter((p) => p.judgmentId).length,
      running: b.passes.some((p) => p.sides.some(sideWriting))
    }))
}

/** Stops whatever is writing and forgets the battle. The comparisons that judged its passes stay in the list. */
export function deleteBattle(id: string): void {
  for (const [slot, controller] of running) if (slot.startsWith(`${id}:`)) controller.abort()
  db.kvDelete(`battle:${id}`)
  db.kvSet('battles', (db.kvGet<string[]>('battles') ?? []).filter((x) => x !== id))
}

// ——— Setting up ———

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

function writer(raw: Partial<BattleWriter> | undefined, letter: string): BattleWriter {
  const w = { providerId: text(raw?.providerId), modelId: text(raw?.modelId), effort: typeof raw?.effort === 'string' && raw.effort ? raw.effort : null, label: text(raw?.label).trim() }
  if (!w.providerId || !w.modelId) throw new Error(`Choose a model for writer ${letter}.`)
  if (!w.label) throw new Error(`Give writer ${letter} a name: the result and the leaderboard go by it.`)
  return w
}

export function createBattle(contents: WebContents, raw: BattleSetup): BattleView {
  const writers: [BattleWriter, BattleWriter] = [writer(raw.writers?.[0], 'A'), writer(raw.writers?.[1], 'B')]
  if (writers[0].label.toLowerCase() === writers[1].label.toLowerCase()) throw new Error('Give the two writers different names: the leaderboard tallies by name.')
  if (!text(raw.authorPrompt).trim()) throw new Error('A battle needs a prompt for both models to write from.')
  const rubrics = judge.listRubrics()
  const rubric = rubrics.find((r) => r.id === raw.rubricId) ?? rubrics[0]
  const setup: BattleSetup = {
    title: text(raw.title).trim(),
    authorPrompt: text(raw.authorPrompt),
    systemPrompt: text(raw.systemPrompt),
    contextDocs: Array.isArray(raw.contextDocs) ? raw.contextDocs.filter((d) => d && typeof d.name === 'string' && typeof d.text === 'string').map((d) => ({ name: d.name, text: d.text })) : [],
    continueText: text(raw.continueText).trim() || DEFAULT_CONTINUE,
    writers,
    extraInstructions: text(raw.extraInstructions),
    judgeProviderId: text(raw.judgeProviderId),
    judgeModelId: text(raw.judgeModelId),
    effort: typeof raw.effort === 'string' && raw.effort ? raw.effort : null,
    rubricId: rubric.id,
    bothOrders: raw.bothOrders !== false
  }
  const battle: Battle = { id: randomUUID(), createdAt: Date.now(), setup, rubric, passes: [] }
  save(battle)
  return addPass(contents, battle.id)
}

/** Another pass: both models write from the same setup again, with nothing of the earlier passes. */
export function addPass(contents: WebContents, id: string): BattleView {
  const b = need(id)
  if (b.passes.length >= MAX_PASSES) throw new Error(`A battle takes up to ${MAX_PASSES} passes.`)
  if (b.passes.at(-1)?.sides.some(sideWriting)) throw new Error('This pass is still being written. Let it finish, or stop it, before starting another.')
  b.passes.push({ sides: [{ turns: [], finished: false }, { turns: [], finished: false }] })
  save(b)
  const pass = b.passes.length - 1
  write(contents, id, pass, 0)
  write(contents, id, pass, 1)
  return view(need(id))
}

// ——— Writing ———

type Block = { type: 'text'; text: string }

const escapeAttr = (s: string): string => s.replace(/"/g, "'")

/** The first message: the reference files as chat sends attached documents, then the prompt. */
function firstMessage(setup: BattleSetup): Block[] {
  return [
    ...setup.contextDocs.map((d): Block => ({ type: 'text', text: `<document name="${escapeAttr(d.name)}">\n${d.text}\n</document>` })),
    { type: 'text', text: setup.authorPrompt }
  ]
}

function row(id: string, role: 'user' | 'assistant', blocks: Block[]): db.NodeRow {
  return {
    id, conversation_id: 'battle', parent_id: null, role, text: blocks.map((b) => b.text).join('\n\n'), content: JSON.stringify(blocks),
    thinking: null, model: null, provider_id: null, usage: null, status: 'done', error: null, active_child_id: null, created_at: Date.now()
  }
}

/**
 * Starts a side's next turn: its first reply, or (when it has written something) what follows the
 * continue instruction. The request is the same for both models and holds nothing but the setup
 * and what this side has written in this pass.
 */
function write(contents: WebContents, id: string, pass: number, sideIndex: number): void {
  const slot = slotOf(id, pass, sideIndex)
  if (running.has(slot)) throw new Error('That side is still writing.')
  const b = need(id)
  const side = sideOf(b, pass, sideIndex)
  if (side.finished) throw new Error('That side is marked finished. Untick Finished to change it.')
  const turn = side.turns.length
  const written = side.turns.filter((t) => t.text.trim())
  side.turns.push({ text: '', status: 'streaming' })
  dropJudgment(b, pass)
  save(b)

  const controller = new AbortController()
  running.set(slot, controller)
  const nodeId = `${slot}:${turn}`
  const emit = (event: StreamEvent): void => {
    if (!contents.isDestroyed()) contents.send('twilight:stream', event)
  }
  const finish = (patch: Partial<BattleTurn>): void => {
    running.delete(slot)
    // Read-modify-write is synchronous here, so the two sides can't overwrite each other.
    const now = load(id)
    const at = now?.passes[pass]?.sides[sideIndex]?.turns[turn]
    if (!now || !at) return
    Object.assign(at, patch)
    save(now)
    emit({ kind: 'done', conversationId: 'battle', nodeId, node: { id: nodeId, parentId: id, role: 'assistant', text: at.text, status: at.status, createdAt: Date.now(), siblingIndex: 0, siblingCount: 1 } })
  }

  const { setup } = b
  const who = setup.writers[sideIndex]
  const history: db.NodeRow[] = [row(`${nodeId}:u0`, 'user', firstMessage(setup))]
  written.forEach((t, i) => {
    history.push(row(`${nodeId}:a${i}`, 'assistant', [{ type: 'text', text: t.text }]))
    history.push(row(`${nodeId}:u${i + 1}`, 'user', [{ type: 'text', text: setup.continueText }]))
  })

  void (async () => {
    let got = ''
    try {
      const config = getProvider(who.providerId)
      // Your usual writing settings (length, temperature, caching), with everything that reaches
      // outside the page off: a battle is the setup and the model, nothing else.
      const settings: ChatSettings = {
        ...getDefaults(),
        providerId: who.providerId,
        modelId: who.modelId,
        systemPrompt: setup.systemPrompt,
        effort: who.effort,
        messageLimit: null,
        confidence: false,
        choiceCards: false,
        choiceTool: false,
        webSearch: false,
        webFetch: false,
        dateTime: false,
        mcpServers: [],
        imageGen: false,
        library: false,
        pendingInstruction: ''
      }
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        system: setup.systemPrompt,
        history,
        settings,
        options: modelOptions(who.providerId, who.modelId),
        signal: controller.signal,
        onText: (delta) => {
          got += delta
          emit({ kind: 'text', conversationId: 'battle', nodeId, delta })
        },
        onThinking: () => undefined
      })
      finish({ text: result.text || got, status: controller.signal.aborted ? 'stopped' : result.error ? 'error' : 'done', error: result.error, usage: result.usage, modelId: result.modelId })
      appendLog({ kind: 'battle', battle: id, pass: pass + 1, side: sideIndex === 0 ? 'A' : 'B', model: result.modelId, title: setup.title, response: result.text })
    } catch (err) {
      const stopped = controller.signal.aborted
      finish({ text: got, status: stopped ? 'stopped' : 'error', error: stopped ? undefined : (describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err))) })
    }
  })()
}

/** A pass's verdict stands for the text it judged: once that text changes, the comparison is removed. */
function dropJudgment(b: Battle, pass: number): void {
  const at = b.passes[pass]
  if (!at?.judgmentId) return
  judge.deleteJudgment(at.judgmentId)
  delete at.judgmentId
}

export function continueSide(contents: WebContents, id: string, pass: number, side: number): BattleView {
  write(contents, id, pass, side)
  return view(need(id))
}

/** Throws away what a side wrote in this pass and has it write again from the start. */
export function redoSide(contents: WebContents, id: string, pass: number, side: number): BattleView {
  if (running.has(slotOf(id, pass, side))) throw new Error('That side is still writing. Stop it first.')
  const b = need(id)
  const at = sideOf(b, pass, side)
  if (at.finished) throw new Error('That side is marked finished. Untick Finished to change it.')
  at.turns = []
  dropJudgment(b, pass)
  save(b)
  write(contents, id, pass, side)
  return view(need(id))
}

export function stopSide(id: string, pass: number, side: number): void {
  running.get(slotOf(id, pass, side))?.abort()
}

/** Locks a side as done, or unlocks it. A locked side can't be continued or started again. */
export function setFinished(id: string, pass: number, side: number, finished: boolean): BattleView {
  const b = need(id)
  const at = sideOf(b, pass, side)
  if (finished) {
    if (sideWriting(at)) throw new Error('That side is still writing. Let it finish, or stop it, first.')
    if (!passageOf(at)) throw new Error('There is nothing written on that side yet.')
  }
  at.finished = !!finished
  save(b)
  return view(b)
}

// ——— Judging ———

function inputFor(b: Battle, pass: number): JudgeInput {
  const { setup } = b
  const [a, z] = b.passes[pass].sides
  return {
    title: `${setup.title || 'Battle'} · pass ${pass + 1}`,
    passageA: passageOf(a),
    passageB: passageOf(z),
    labelA: setup.writers[0].label,
    labelB: setup.writers[1].label,
    authorPrompt: setup.authorPrompt,
    systemPrompt: setup.systemPrompt,
    contextDocs: setup.contextDocs,
    extraInstructions: setup.extraInstructions,
    judgeProviderId: setup.judgeProviderId,
    judgeModelId: setup.judgeModelId,
    effort: setup.effort,
    rubricId: b.rubric.id,
    bothOrders: setup.bothOrders,
    rubricAsJudged: b.rubric,
    pass: pass + 1
  }
}

/**
 * Judges the chosen passes, each as its own blind comparison of what the two models wrote in that
 * pass. A pass judged before is judged again and its earlier comparison replaced.
 */
export function judgePasses(contents: WebContents, id: string, passes: number[]): BattleView {
  const b = need(id)
  const wanted = [...new Set(Array.isArray(passes) ? passes : [])].filter((p) => Number.isInteger(p) && p >= 0 && p < b.passes.length).sort((x, y) => x - y)
  if (!wanted.length) throw new Error('Choose at least one pass to judge.')
  const unready = wanted.find((p) => !passReady(b.passes[p]))
  if (unready !== undefined) throw new Error(`Pass ${unready + 1} isn't marked finished on both sides yet.`)
  for (const p of wanted) dropJudgment(b, p)
  const judgments = judge.runPasses(contents, wanted.map((p) => inputFor(b, p)), id)
  wanted.forEach((p, i) => (b.passes[p].judgmentId = judgments[i].id))
  save(b)
  return view(b)
}
