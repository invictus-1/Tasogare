import { create } from 'zustand'
import { DEFAULT_CONTINUE, type BattleSetup, type BattleSummary, type BattleView } from '@shared/battle'
import type { JudgeInput, Judgment, JudgmentSummary, Leaderboard, Rubric } from '@shared/judge'
import { useStore } from './store'

const api = window.twilight

interface JudgeState {
  list: JudgmentSummary[]
  rubrics: Rubric[]
  /** The judgment on screen. */
  current: Judgment | null
  /** A comparison being set up (shown instead of `current`). */
  draft: JudgeInput | null
  /** The leaderboard on screen, overall or for one round (shown when there's no draft or judgment). */
  board: Leaderboard | null
  /** Fresh battles, newest first. */
  battles: BattleSummary[]
  /** The battle on screen, with the comparisons that judged its passes. */
  battle: BattleView | null
  /** A battle being set up. */
  battleDraft: BattleSetup | null
  error: string | null

  init(): Promise<void>
  refresh(): Promise<void>
  open(id: string): Promise<void>
  /** Shows the leaderboard: the overall one, or one round's. */
  openBoard(roundId?: string | null): Promise<void>
  newDraft(prefill?: Partial<JudgeInput>): void
  updateDraft(patch: Partial<JudgeInput>): void
  run(): Promise<void>
  stop(): Promise<void>
  remove(id: string): Promise<void>
  /** Reloads the judgment on screen (after a run finishes). */
  reload(id: string): Promise<void>
  newBattle(prefill?: Partial<BattleSetup>): void
  updateBattleDraft(patch: Partial<BattleSetup>): void
  startBattle(): Promise<void>
  openBattle(id: string): Promise<void>
  /** Reloads the battle on screen (after a turn finishes, or one of its passes is judged). */
  reloadBattle(id?: string): Promise<void>
  /** Runs one of the battle calls and shows what comes back, or the reason it was refused. */
  battleDo(call: () => Promise<BattleView | void>): Promise<void>
  removeBattle(id: string): Promise<void>
  /** Back to the start page, with nothing open. */
  home(): void
  setRubrics(rubrics: Rubric[]): void
}

const WINNER_TEXT = { A: 'A won', B: 'B won', tie: 'Tie', close: 'Too close to call' } as const

/** How a comparison stands, in a couple of words, for the lists of them. */
export function judgmentState(j: JudgmentSummary): string {
  return j.status === 'running' ? 'Judging…' : j.status === 'error' ? 'Failed' : j.winner ? WINNER_TEXT[j.winner] : 'No verdict'
}

/** How a fresh battle stands, in a few words, for the lists of them. */
export function battleState(b: BattleSummary): string {
  const passes = `${b.passes} ${b.passes === 1 ? 'pass' : 'passes'}`
  return b.running ? `Battle · writing pass ${b.passes}` : b.judged ? `Battle · ${b.judged} of ${passes} judged` : `Battle · ${passes}`
}

const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The rubric used last, so a rubric of your own stays the default once you've picked it. */
function lastRubric(): string {
  try {
    return localStorage.getItem('twilight.judgeRubric') ?? 'general-fiction'
  } catch {
    return 'general-fiction'
  }
}

function emptyInput(): JudgeInput {
  const defaults = useStore.getState().defaults
  return {
    title: '',
    passageA: '',
    passageB: '',
    labelA: '',
    labelB: '',
    authorPrompt: '',
    systemPrompt: '',
    contextDocs: [],
    extraInstructions: '',
    judgeProviderId: defaults?.providerId ?? 'anthropic',
    judgeModelId: defaults?.modelId ?? 'claude-opus-5-5',
    effort: null,
    rubricId: lastRubric(),
    bothOrders: true
  }
}

function emptyBattle(): BattleSetup {
  const base = emptyInput()
  const s = useStore.getState()
  const name = (id: string): string => s.models.find((m) => m.id === id)?.name ?? id
  return {
    title: '',
    authorPrompt: '',
    systemPrompt: '',
    contextDocs: [],
    continueText: DEFAULT_CONTINUE,
    writers: [
      { providerId: base.judgeProviderId, modelId: base.judgeModelId, effort: null, label: name(base.judgeModelId) },
      { providerId: base.judgeProviderId, modelId: base.judgeModelId, effort: null, label: '' }
    ],
    extraInstructions: '',
    judgeProviderId: base.judgeProviderId,
    judgeModelId: base.judgeModelId,
    effort: null,
    rubricId: base.rubricId,
    bothOrders: true
  }
}

/** Nothing open: what every way of opening something starts from, so only one thing shows. */
const CLOSED = { current: null, draft: null, board: null, battle: null, battleDraft: null } as const

export const useJudge = create<JudgeState>((set, get) => ({
  list: [],
  rubrics: [],
  current: null,
  draft: null,
  board: null,
  battles: [],
  battle: null,
  battleDraft: null,
  error: null,

  async init() {
    const [list, rubrics, battles] = await Promise.all([api.listJudgments(), api.listRubrics(), api.listBattles()])
    set({ list, rubrics, battles })
  },

  async refresh() {
    const board = get().board
    const [list, fresh, battles] = await Promise.all([api.listJudgments(), board ? api.getLeaderboard(board.roundId) : null, api.listBattles()])
    // A leaderboard closed or switched while this was loading stays as it now is.
    set(get().board?.roundId === board?.roundId && get().board ? { list, battles, board: fresh } : { list, battles })
    // A battle on screen shows its passes' verdicts, which this may have just changed.
    if (get().battle) await get().reloadBattle()
  },

  async open(id) {
    try {
      set({ ...CLOSED, current: await api.getJudgment(id) })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async openBoard(roundId = null) {
    try {
      set({ ...CLOSED, board: await api.getLeaderboard(roundId) })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  newDraft(prefill = {}) {
    set({ ...CLOSED, draft: { ...emptyInput(), ...prefill } })
  },

  updateDraft(patch) {
    const draft = get().draft
    if (draft) set({ draft: { ...draft, ...patch } })
    if (patch.rubricId) {
      try {
        localStorage.setItem('twilight.judgeRubric', patch.rubricId)
      } catch {
        // Storage unavailable: the default just isn't remembered.
      }
    }
  },

  async run() {
    const draft = get().draft
    if (!draft) return
    try {
      if (draft.morePassages?.length) {
        // A round: every pair becomes its own judgment, and the round's leaderboard fills in.
        const { roundId } = await api.runJudgeRound(draft)
        set({ error: null })
        await get().openBoard(roundId)
      } else {
        const { morePassages: _more, ...pair } = draft
        set({ current: await api.runJudge(pair), draft: null, error: null })
      }
      await get().refresh()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async stop() {
    const current = get().current
    if (current) await api.stopJudge(current.id)
  },

  async remove(id) {
    await api.deleteJudgment(id)
    if (get().current?.id === id) set({ current: null })
    await get().refresh()
  },

  async reload(id) {
    if (get().current?.id === id) set({ current: await api.getJudgment(id) })
    // refresh() also re-tallies the leaderboard on screen, so a round fills in as pairs finish.
    await get().refresh()
  },

  newBattle(prefill = {}) {
    set({ ...CLOSED, battleDraft: { ...emptyBattle(), ...prefill } })
  },

  updateBattleDraft(patch) {
    const battleDraft = get().battleDraft
    if (battleDraft) set({ battleDraft: { ...battleDraft, ...patch } })
  },

  async startBattle() {
    const battleDraft = get().battleDraft
    if (!battleDraft) return
    try {
      set({ ...CLOSED, battle: await api.createBattle(battleDraft), error: null })
      await get().refresh()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async openBattle(id) {
    try {
      set({ ...CLOSED, battle: await api.getBattle(id) })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async reloadBattle(id) {
    const open = get().battle?.battle.id
    if (!open || (id && id !== open)) return
    try {
      const fresh = await api.getBattle(open)
      // Closed or switched while this was loading: leave what is on screen.
      if (get().battle?.battle.id === open) set({ battle: fresh })
    } catch {
      // Deleted meanwhile: the list no longer has it either.
    }
  },

  async battleDo(call) {
    try {
      const fresh = await call()
      if (fresh && get().battle?.battle.id === fresh.battle.id) set({ battle: fresh, error: null })
      else await get().reloadBattle()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async removeBattle(id) {
    await api.deleteBattle(id)
    if (get().battle?.battle.id === id) set({ battle: null })
    await get().refresh()
  },

  home: () => set({ ...CLOSED }),

  setRubrics: (rubrics) => set({ rubrics })
}))
