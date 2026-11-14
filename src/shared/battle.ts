import { computeVerdict, type Judgment, type Rubric, type Verdict } from './judge'
import type { Attachment, ChatSettings, Usage } from './types'

// A fresh battle: two models write from the same prompt, system prompt and reference files, with
// no chat behind them, and the Judge compares what they wrote. Each side is written in turns (the
// first reply, then one more for every Continue) until it is marked finished, which locks it. The
// same setup can be run again as another pass, fresh each time, so one lucky or unlucky run does
// not decide it: every pass is judged as its own blind comparison, and the passes you choose are
// averaged.

/** The model settings a writer can be given: how the model is asked, never what it is told. */
export const WRITER_KEYS = ['temperature', 'maxTokens', 'caching', 'cacheTtl', 'samplers', 'extraParams'] as const satisfies readonly (keyof ChatSettings)[]
export type WriterSettings = Partial<Pick<ChatSettings, (typeof WRITER_KEYS)[number]>>

/** One of the two writers: the model, how hard it thinks, and its name on the leaderboard. */
export interface BattleWriter {
  providerId: string
  modelId: string
  effort: string | null
  label: string
  /**
   * In a battle being set up: what you changed from that model's usual settings. Once the battle
   * begins: every setting it is written with, so each pass and each Continue is asked the same way
   * whatever your defaults become later.
   */
  settings?: WriterSettings
}

/** A writer's settings in full: your usual chat settings, then that model's own defaults, then what was changed for this writer. */
export function writerSettings(usual: ChatSettings, model: Partial<ChatSettings>, own?: WriterSettings): WriterSettings {
  const all = { ...usual, ...model, ...own }
  const out: WriterSettings = {}
  for (const k of WRITER_KEYS) (out as Record<string, unknown>)[k] = all[k]
  return out
}

/** Settings in a few words, for the page: only what is switched on or unusual is said. */
export function describeSettings(s: WriterSettings | undefined): string {
  if (!s) return ''
  const parts: string[] = []
  if (s.temperature != null) parts.push(`temperature ${s.temperature}`)
  if (s.maxTokens != null) parts.push(`up to ${s.maxTokens.toLocaleString()} tokens a turn`)
  if (s.caching === false) parts.push('caching off')
  const samplers = Object.entries(s.samplers ?? {}).filter(([, v]) => v !== null && v !== undefined)
  if (samplers.length) parts.push(samplers.map(([k, v]) => `${k} ${v}`).join(', '))
  if (s.extraParams?.trim()) parts.push('extra request parameters')
  return parts.join(' · ')
}

/** What a battle is written from and judged with. */
export interface BattleSetup {
  title: string
  /** The prompt both models write from. */
  authorPrompt: string
  /** The writing system prompt both models are given. */
  systemPrompt: string
  /** Canon and reference documents, given to both models and to the judge. */
  contextDocs: Attachment[]
  /** What a side is sent when it is asked to go on: the same words for both. */
  continueText: string
  writers: [BattleWriter, BattleWriter]
  /** Anything else the author wants judged or answered. */
  extraInstructions: string
  judgeProviderId: string
  judgeModelId: string
  /** The judge's effort. */
  effort: string | null
  rubricId: string
  bothOrders: boolean
}

/** One reply of a side: the first, or what followed a Continue. */
export interface BattleTurn {
  text: string
  status: 'streaming' | 'done' | 'stopped' | 'error'
  error?: string
  usage?: Usage
  modelId?: string
}

export interface BattleSide {
  turns: BattleTurn[]
  /** Locked: it can't be continued or started again until this is unticked. */
  finished: boolean
}

export interface BattlePass {
  sides: [BattleSide, BattleSide]
  /** The comparison that judged this pass as it now stands. */
  judgmentId?: string
}

export interface Battle {
  id: string
  createdAt: number
  setup: BattleSetup
  /** The rubric as it was when the battle began: every pass is judged with it. */
  rubric: Rubric
  passes: BattlePass[]
}

/** A battle with the comparisons that judged its passes (null where a pass has none). */
export interface BattleView {
  battle: Battle
  judgments: (Judgment | null)[]
}

export interface BattleSummary {
  id: string
  title: string
  createdAt: number
  passes: number
  judged: number
  running: boolean
}

/** The most passes a battle takes. */
export const MAX_PASSES = 6

export const DEFAULT_CONTINUE = 'Continue.'

/**
 * A side's turns as one passage. A turn that stopped in the middle of a sentence (the token limit
 * cut it) is joined to the next with a space; otherwise the next turn starts a new paragraph.
 */
export function joinTurns(texts: string[]): string {
  let out = ''
  for (const raw of texts) {
    const text = raw.trim()
    if (!text) continue
    if (!out) out = text
    else out += (/[.!?…:;"”’')\]*_~`—–-]$/.test(out) ? '\n\n' : ' ') + text
  }
  return out
}

export const passageOf = (side: BattleSide): string => joinTurns(side.turns.map((t) => t.text))

export const sideWriting = (side: BattleSide): boolean => side.turns.some((t) => t.status === 'streaming')

/** Both sides written, and locked: the pass can be judged. */
export const passReady = (pass: BattlePass): boolean => pass.sides.every((s) => s.finished && !!passageOf(s))

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length

/** One judged pass as the battle's result shows it. */
export interface PassResult {
  /** 0-based. */
  pass: number
  judgmentId: string
  running: boolean
  overallA: number | null
  overallB: number | null
  winner: Verdict['winner']
}

export interface BattleTally {
  passes: PassResult[]
  /** How many of them have a verdict and so count in the averages. */
  counted: number
  averageA: number | null
  averageB: number | null
  winsA: number
  winsB: number
  /** Ties and too-close calls. */
  drawn: number
  /** Each criterion's score averaged across the counted passes. */
  criteria: { id: string; name: string; weight: number; A: number | null; B: number | null }[]
  /** Who is ahead on average; a tie when the averages are within a quarter of a point. */
  winner: 'A' | 'B' | 'tie' | null
  /** What differs between the passes, in plain sentences. */
  notes: string[]
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const one = (n: number): string => n.toFixed(1)
const listOf = (items: number[]): string => {
  const names = items.map((p) => String(p + 1))
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
}

/** The margin under which two averages count as level. */
export const LEVEL_MARGIN = 0.25

/**
 * Averages the chosen passes. Each pass was judged on its own (blind, as an ordinary comparison);
 * this only combines their verdicts and says where they differ.
 */
export function tallyBattle(rubric: Rubric, judged: { pass: number; judgment: Judgment }[]): BattleTally {
  const verdicts = judged.map(({ pass, judgment }) => ({ pass, judgment, v: computeVerdict(judgment.rubric ?? rubric, judgment.runs) }))
  const passes: PassResult[] = verdicts.map(({ pass, judgment, v }) => ({
    pass,
    judgmentId: judgment.id,
    running: judgment.runs.some((r) => r.status === 'streaming'),
    overallA: v.overallA,
    overallB: v.overallB,
    winner: v.winner
  }))
  const done = verdicts.filter(({ v }) => v.winner !== null && v.overallA !== null && v.overallB !== null)
  const scoresA = done.map(({ v }) => v.overallA as number)
  const scoresB = done.map(({ v }) => v.overallB as number)
  const averageA = mean(scoresA)
  const averageB = mean(scoresB)
  const took = (side: 'A' | 'B'): number[] => done.filter(({ v }) => v.winner === side).map(({ pass }) => pass)
  const drawnPasses = done.filter(({ v }) => v.winner === 'tie' || v.winner === 'close').map(({ pass }) => pass)
  const criteria = rubric.criteria.map((c) => {
    const pick = (side: 'A' | 'B'): number[] =>
      done.map(({ v }) => v.criteria.find((x) => x.id === c.id)?.[side] ?? null).filter((n): n is number => n !== null)
    return { id: c.id, name: c.name, weight: c.weight, A: mean(pick('A')), B: mean(pick('B')) }
  })
  const winner = averageA === null || averageB === null ? null : Math.abs(averageA - averageB) < LEVEL_MARGIN ? 'tie' : averageA > averageB ? 'A' : 'B'

  const notes: string[] = []
  if (done.length > 1) {
    const a = took('A')
    const b = took('B')
    if (a.length === done.length) notes.push('A took every pass.')
    else if (b.length === done.length) notes.push('B took every pass.')
    else {
      const parts = [
        a.length ? `A took pass ${listOf(a)}` : '',
        b.length ? `B took pass ${listOf(b)}` : '',
        drawnPasses.length ? `pass ${listOf(drawnPasses)} was too close to call` : ''
      ].filter(Boolean)
      notes.push(`The passes disagree: ${parts.join(', ')}.`)
    }
    for (const [side, scores] of [['A', scoresA], ['B', scoresB]] as const) {
      const low = Math.min(...scores)
      const high = Math.max(...scores)
      if (high - low >= 1) notes.push(`${side} was uneven from pass to pass: its overall score ran from ${one(low)} to ${one(high)}.`)
    }
    if (averageA !== null && averageB !== null && winner === 'tie') notes.push(`On average they are level (within ${LEVEL_MARGIN} of a point).`)
  }
  const widest = criteria
    .filter((c) => c.A !== null && c.B !== null)
    .sort((x, y) => Math.abs((y.A as number) - (y.B as number)) - Math.abs((x.A as number) - (x.B as number)))[0]
  if (done.length && widest && Math.abs((widest.A as number) - (widest.B as number)) >= 0.5)
    notes.push(`The widest gap is ${widest.name}: A ${one(widest.A as number)}, B ${one(widest.B as number)}.`)

  return { passes, counted: done.length, averageA, averageB, winsA: took('A').length, winsB: took('B').length, drawn: drawnPasses.length, criteria, winner, notes }
}
