import { useEffect, useState, useSyncExternalStore } from 'react'
import { countWords, MAX_PASSES, passageOf, passReady, sideWriting, tallyBattle, type BattlePass, type BattleSetup, type BattleSide, type BattleWriter } from '@shared/battle'
import { formatTokens } from '@shared/pricing'
import { useJudge } from '../judgeStore'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { modelName, optionsFor, useStore } from '../store'
import { readStream, subscribeStream } from '../stream'
import { CloseIcon, PaperclipIcon, PlusIcon, StopIcon, TrophyIcon } from './Icons'

// A fresh battle (see @shared/battle): the form that sets one up, and the battle itself, where
// both models write side by side, pass after pass, and the passes you choose are judged.

const LETTERS = ['A', 'B'] as const
const fmt = (v: number | null): string => (v === null ? '–' : v.toFixed(1))
const WON = { A: 'A won', B: 'B won', tie: 'Tie', close: 'Too close to call' } as const

async function pickText(): Promise<{ name: string; text: string }[]> {
  try {
    return await window.twilight.pickAttachments()
  } catch (err) {
    useJudge.setState({ error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) })
    return []
  }
}

// ——— Setting up a battle ———

function WriterField({ index }: { index: number }) {
  const draft = useJudge((s) => s.battleDraft)!
  const update = useJudge((s) => s.updateBattleDraft)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const writer = draft.writers[index]
  const options = optionsFor(models, providers, writer.providerId, writer.modelId)
  const set = (patch: Partial<BattleWriter>): void => {
    const writers = draft.writers.map((w, i) => (i === index ? { ...w, ...patch } : w)) as BattleSetup['writers']
    update({ writers })
  }
  return (
    <div className="battle-writer" data-writer={LETTERS[index]}>
      <span className={`tw-pane-tag judge-tag-${LETTERS[index].toLowerCase()}`}>{LETTERS[index]}</span>
      <label className="field">
        <span className="field-label">Model</span>
        <select
          value={`${writer.providerId}::${writer.modelId}`}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split('::')
            // The name follows the model until you have given it one of your own.
            const named = writer.label && writer.label !== modelName(models, writer.modelId)
            set({ providerId, modelId, effort: null, ...(named ? {} : { label: modelName(models, modelId) }) })
          }}
        >
          {!models.some((m) => m.providerId === writer.providerId && m.id === writer.modelId) && (
            <option value={`${writer.providerId}::${writer.modelId}`}>{modelName(models, writer.modelId)}</option>
          )}
          {providers.filter((p) => p.enabled).map((p) => (
            <optgroup key={p.id} label={p.name}>
              {models.filter((m) => m.providerId === p.id).map((m) => (
                <option key={m.id} value={`${p.id}::${m.id}`}>{m.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {options.efforts.length > 0 && (
        <label className="field">
          <span className="field-label">Effort</span>
          <select value={writer.effort ?? ''} onChange={(e) => set({ effort: e.target.value || null })}>
            <option value="">{options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'}</option>
            {options.efforts.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">Name in the result</span>
        <input className="battle-label" value={writer.label} placeholder="e.g. the model's name" onChange={(e) => set({ label: e.target.value })} />
      </label>
    </div>
  )
}

export function BattleForm() {
  const draft = useJudge((s) => s.battleDraft)!
  const update = useJudge((s) => s.updateBattleDraft)
  const rubrics = useJudge((s) => s.rubrics)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const folders = useStore((s) => s.folders)
  const options = optionsFor(models, providers, draft.judgeProviderId, draft.judgeModelId)
  const rubric = rubrics.find((r) => r.id === draft.rubricId) ?? rubrics[0]
  const contextChars = draft.contextDocs.reduce((n, d) => n + d.text.length, 0) + draft.systemPrompt.length + draft.authorPrompt.length
  const labels = draft.writers.map((w) => w.label.trim().toLowerCase())
  const problem = !draft.authorPrompt.trim()
    ? 'Write the prompt both models will answer'
    : labels.some((l) => !l)
      ? 'Give both writers a name'
      : labels[0] === labels[1]
        ? 'Give the two writers different names'
        : null

  return (
    <div className="judge-form battle-form">
      <p className="field-note judge-carried">
        Both models write from exactly what is on this page, with no chat behind them. You say when each is finished, run it again as often as you like, and
        the Judge compares the passes you choose.
      </p>
      <label className="field">
        <span className="field-label">Title</span>
        <input value={draft.title} placeholder="e.g. Harbour scene — two models, fresh" onChange={(e) => update({ title: e.target.value })} />
      </label>

      <h3 className="settings-section">The two writers</h3>
      <WriterField index={0} />
      <WriterField index={1} />
      <p className="field-note">Each writes with your usual chat settings for length and temperature. Search, tools and pictures are off, so nothing but this page reaches them.</p>

      <h3 className="settings-section">What both write from</h3>
      <label className="field">
        <span className="field-label">Prompt</span>
        <textarea className="battle-prompt" rows={6} value={draft.authorPrompt} placeholder="The prompt both models answer" onChange={(e) => update({ authorPrompt: e.target.value })} />
      </label>
      <div className="field">
        <span className="field-label judge-row">
          Writing system prompt
          {folders.some((f) => f.systemPrompt.trim()) && (
            <select value="" onChange={(e) => {
              const ws = folders.find((f) => f.id === e.target.value)
              if (ws) update({ systemPrompt: ws.systemPrompt })
            }}>
              <option value="">Use a workspace's prompt…</option>
              {folders.filter((f) => f.systemPrompt.trim()).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
        </span>
        <textarea rows={4} value={draft.systemPrompt} placeholder="The system prompt both models are given" onChange={(e) => update({ systemPrompt: e.target.value })} />
      </div>
      <div className="field">
        <span className="field-label">Reference files (character profiles, series notes…), given to both models and to the judge</span>
        <div className="tw-attach">
          {draft.contextDocs.map((d, i) => (
            <span key={`${d.name}-${i}`} className="tw-badge attach-chip">
              <PaperclipIcon size={13} />
              {d.name}
              <span className="attach-size">~{formatTokens(Math.round(d.text.length / 4))}</span>
              <button className="attach-remove" aria-label={`Remove ${d.name}`} onClick={() => update({ contextDocs: draft.contextDocs.filter((_, j) => j !== i) })}>
                <CloseIcon size={11} />
              </button>
            </span>
          ))}
          <button className="tw-btn tw-btn-sm" onClick={async () => update({ contextDocs: [...draft.contextDocs, ...(await pickText())] })}>
            <PaperclipIcon size={14} />
            Attach files
          </button>
        </div>
        <span className="field-note">About {formatTokens(Math.round(contextChars / 4))} tokens go to each model at the start of every pass.</span>
      </div>
      <label className="field">
        <span className="field-label">What Continue sends</span>
        <input value={draft.continueText} placeholder="Continue." onChange={(e) => update({ continueText: e.target.value })} />
        <span className="field-note">Each side has its own Continue, for when it stops before the prompt is done. Both are sent these same words.</span>
      </label>

      <h3 className="settings-section">Judge</h3>
      <div className="judge-settings">
        <label className="field">
          <span className="field-label">Judge model</span>
          <select
            value={`${draft.judgeProviderId}::${draft.judgeModelId}`}
            onChange={(e) => {
              const [judgeProviderId, judgeModelId] = e.target.value.split('::')
              update({ judgeProviderId, judgeModelId, effort: null })
            }}
          >
            {!models.some((m) => m.providerId === draft.judgeProviderId && m.id === draft.judgeModelId) && (
              <option value={`${draft.judgeProviderId}::${draft.judgeModelId}`}>{modelName(models, draft.judgeModelId)}</option>
            )}
            {providers.filter((p) => p.enabled).map((p) => (
              <optgroup key={p.id} label={p.name}>
                {models.filter((m) => m.providerId === p.id).map((m) => (
                  <option key={m.id} value={`${p.id}::${m.id}`}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {options.efforts.length > 0 && (
          <label className="field">
            <span className="field-label">Effort</span>
            <select value={draft.effort ?? ''} onChange={(e) => update({ effort: e.target.value || null })}>
              <option value="">{options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'}</option>
              {options.efforts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Rubric</span>
          <select value={draft.rubricId} onChange={(e) => update({ rubricId: e.target.value })}>
            {rubrics.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>
      {rubric && <p className="field-note">{rubric.description} {rubric.criteria.length} criteria: {rubric.criteria.map((c) => c.name).join(', ')}. Every pass is judged with the rubric as it is now.</p>}
      <label className="field">
        <span className="field-label">Anything else to ask the judge (optional)</span>
        <textarea rows={2} value={draft.extraInstructions} onChange={(e) => update({ extraInstructions: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.bothOrders} onChange={(e) => update({ bothOrders: e.target.checked })} />
        Judge each pass twice with the order swapped (judges tend to favour whichever passage comes first)
      </label>

      <div className="dialog-actions">
        <button className="tw-btn tw-btn-ghost" onClick={() => useJudge.getState().home()}>
          Cancel
        </button>
        <button className="tw-btn tw-btn-primary battle-start" disabled={!!problem} title={problem ?? undefined} onClick={() => void useJudge.getState().startBattle()}>
          Start the battle
        </button>
      </div>
    </div>
  )
}

// ——— The battle ———

/** The turn being written now, as it streams. */
function LiveTurn({ nodeId }: { nodeId: string }) {
  const subscribe = (cb: () => void): (() => void) => subscribeStream(nodeId, cb)
  const live = useSyncExternalStore(subscribe, () => readStream(nodeId).text)
  return live ? (
    <div className="md battle-live" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(live) }} />
  ) : (
    <div className="msg-pending">
      <span className="tw-spin" /> Writing
    </div>
  )
}

function SidePanel({ id, pass, index, side, writer, judged }: { id: string; pass: number; index: number; side: BattleSide; writer: BattleWriter; judged: boolean }) {
  const models = useStore((s) => s.models)
  const [confirming, setConfirming] = useState(false)
  const run = useJudge((s) => s.battleDo)
  const api = window.twilight
  const writing = sideWriting(side)
  const written = passageOf({ ...side, turns: side.turns.filter((t) => t.status !== 'streaming') })
  const parts = side.turns.filter((t) => t.text.trim() || t.status === 'streaming').length
  const last = side.turns.at(-1)
  const letter = LETTERS[index]
  useEffect(() => setConfirming(false), [pass, writing, side.finished])
  return (
    <section className={`battle-side battle-side-${letter.toLowerCase()} ${side.finished ? 'battle-locked' : ''}`} data-side={letter}>
      <header className="battle-side-head">
        <span className={`tw-pane-tag judge-tag-${letter.toLowerCase()}`}>{letter}</span>
        <span className="battle-side-name">{writer.label}</span>
        <span className="battle-side-meta">
          {writing ? 'Writing… · ' : ''}
          {countWords(written).toLocaleString()} words{parts > 1 ? ` · ${parts} parts` : ''}
          {writer.label !== modelName(models, writer.modelId) ? ` · ${modelName(models, writer.modelId)}` : ''}
        </span>
      </header>
      <div className="battle-text">
        {written && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(`${id}:${pass}:${index}`, written) }} />}
        {writing && <LiveTurn nodeId={`${id}:${pass}:${index}:${side.turns.length - 1}`} />}
        {!written && !writing && <p className="field-note">Nothing written yet.</p>}
      </div>
      {last?.error && !writing && (
        <div className="tw-msg-error">
          <strong>{last.status === 'stopped' ? 'Stopped.' : 'Problem.'}</strong> {last.error}
        </div>
      )}
      <footer className="battle-side-foot">
        {writing ? (
          <button className="tw-btn tw-btn-sm battle-stop" onClick={() => void api.stopBattleSide(id, pass, index)}>
            <StopIcon size={14} />
            Stop
          </button>
        ) : (
          <>
            <button
              className="tw-btn tw-btn-sm battle-continue"
              disabled={side.finished}
              title={side.finished ? 'Marked finished: untick Finished to go on' : written ? 'Asks this side to go on from where it stopped' : 'Has this side write again'}
              onClick={() => void run(() => api.continueBattleSide(id, pass, index))}
            >
              {written ? 'Continue' : 'Try again'}
            </button>
            {written &&
              (confirming ? (
                <button className="tw-btn tw-btn-sm danger-text battle-redo" onClick={() => void run(() => api.redoBattleSide(id, pass, index))}>
                  Discard this and write again
                </button>
              ) : (
                <button className="tw-btn tw-btn-ghost tw-btn-sm battle-redo" disabled={side.finished} title="Throws away what this side wrote in this pass and has it write again" onClick={() => setConfirming(true)}>
                  Start again
                </button>
              ))}
          </>
        )}
        <span className="tw-spacer" />
        <label className="check battle-finished" title={judged ? 'This pass has been judged as it stands' : 'Locks this side: it can no longer be continued or started again until you untick this'}>
          <input
            type="checkbox"
            checked={side.finished}
            disabled={writing || (!side.finished && !written)}
            onChange={(e) => void run(() => api.setBattleFinished(id, pass, index, e.target.checked))}
          />
          Finished
        </label>
      </footer>
    </section>
  )
}

/** A pass's state in a couple of words, for its tab and its tick box. */
function passState(pass: BattlePass, judged: boolean, judging: boolean): string {
  if (pass.sides.some(sideWriting)) return 'writing'
  if (judging) return 'judging'
  if (judged) return 'judged'
  return passReady(pass) ? 'finished' : 'not finished'
}

export function BattleScreen() {
  const view = useJudge((s) => s.battle)!
  const run = useJudge((s) => s.battleDo)
  const models = useStore((s) => s.models)
  const { battle, judgments } = view
  const { setup } = battle
  const [tab, setTab] = useState(battle.passes.length - 1)
  // Which passes the next judging and the averages take in; a new pass is in until unticked.
  const [left, setLeft] = useState<Set<number>>(new Set())
  const [showSetup, setShowSetup] = useState(false)
  useEffect(() => setTab(battle.passes.length - 1), [battle.id, battle.passes.length])
  const at = Math.min(tab, battle.passes.length - 1)
  const pass = battle.passes[at]
  const chosen = battle.passes.map((_, i) => i).filter((i) => !left.has(i))
  const ready = chosen.filter((i) => passReady(battle.passes[i]))
  const toJudge = ready.filter((i) => !judgments[i])
  const judging = (i: number): boolean => !!judgments[i]?.runs.some((r) => r.status === 'streaming')
  const judged = chosen.flatMap((i) => (judgments[i] ? [{ pass: i, judgment: judgments[i] }] : []))
  const tally = tallyBattle(battle.rubric, judged)
  const lastWriting = battle.passes.at(-1)?.sides.some(sideWriting) ?? false
  const api = window.twilight
  const names = setup.writers.map((w) => w.label)
  const who = (side: 'A' | 'B'): string => `${side} · ${names[side === 'A' ? 0 : 1]}`

  return (
    <div className="judge-result battle" data-battle={battle.id}>
      <p className="ins-note battle-about">
        {names[0]} against {names[1]}, written fresh from the same prompt{setup.contextDocs.length ? ` and ${setup.contextDocs.length} reference ${setup.contextDocs.length === 1 ? 'file' : 'files'}` : ''} · judged by{' '}
        {modelName(models, setup.judgeModelId)} with {battle.rubric.name}{' '}
        <button className="link-btn" aria-expanded={showSetup} onClick={() => setShowSetup((o) => !o)}>
          {showSetup ? 'Hide what they write from' : 'Show what they write from'}
        </button>
      </p>
      {showSetup && (
        <section className="ins-card battle-setup">
          <h3 className="ins-card-title">Prompt</h3>
          <p className="battle-setup-text">{setup.authorPrompt}</p>
          {setup.systemPrompt.trim() && (
            <>
              <h3 className="ins-card-title">Writing system prompt</h3>
              <p className="battle-setup-text">{setup.systemPrompt}</p>
            </>
          )}
          {setup.contextDocs.length > 0 && (
            <>
              <h3 className="ins-card-title">Reference files</h3>
              <p className="battle-setup-text">{setup.contextDocs.map((d) => d.name).join(', ')}</p>
            </>
          )}
          <p className="field-note">Continue sends: {setup.continueText}</p>
        </section>
      )}

      <div className="battle-passes">
        <div className="tw-seg" role="tablist" aria-label="Passes">
          {battle.passes.map((p, i) => (
            <button key={i} role="tab" aria-pressed={at === i} className="battle-pass-tab" title={passState(p, !!judgments[i], judging(i))} onClick={() => setTab(i)}>
              Pass {i + 1}
            </button>
          ))}
        </div>
        <button
          className="tw-btn tw-btn-sm battle-new-pass"
          disabled={lastWriting || battle.passes.length >= MAX_PASSES}
          title={
            battle.passes.length >= MAX_PASSES
              ? `A battle takes up to ${MAX_PASSES} passes`
              : lastWriting
                ? 'This pass is still being written'
                : 'Both models write from the same prompt again, fresh: nothing of the earlier passes reaches them'
          }
          onClick={() => void run(() => api.addBattlePass(battle.id))}
        >
          <PlusIcon />
          Pass {battle.passes.length + 1}
        </button>
        <span className="field-note battle-pass-state">Pass {at + 1}: {passState(pass, !!judgments[at], judging(at))}</span>
      </div>

      <div className="battle-sides">
        {pass.sides.map((side, i) => (
          <SidePanel key={`${at}:${i}`} id={battle.id} pass={at} index={i} side={side} writer={setup.writers[i]} judged={!!judgments[at]} />
        ))}
      </div>

      <section className="ins-card battle-judge">
        <h3 className="ins-card-title">Judge</h3>
        <div className="battle-picks">
          {battle.passes.map((p, i) => (
            <label key={i} className="check battle-pick" data-pass={i + 1}>
              <input
                type="checkbox"
                checked={!left.has(i)}
                onChange={(e) => {
                  const next = new Set(left)
                  if (e.target.checked) next.delete(i)
                  else next.add(i)
                  setLeft(next)
                }}
              />
              Pass {i + 1}
              <span className="battle-pick-state">{passState(p, !!judgments[i], judging(i))}</span>
            </label>
          ))}
          <span className="tw-spacer" />
          <button
            className="tw-btn tw-btn-primary battle-judge-run"
            disabled={!ready.length || ready.some(judging)}
            title={!ready.length ? 'Tick Finished on both sides of a pass to judge it' : undefined}
            onClick={() => void run(() => api.judgeBattle(battle.id, toJudge.length ? toJudge : ready))}
          >
            <TrophyIcon />
            {toJudge.length ? `Judge ${toJudge.length === 1 ? `pass ${toJudge[0] + 1}` : `${toJudge.length} passes`}` : ready.length ? `Judge ${ready.length === 1 ? 'it' : 'them'} again` : 'Judge'}
          </button>
        </div>
        <p className="field-note">
          Each pass is judged as its own blind comparison of what the two wrote in that pass{setup.bothOrders ? ', in both orders' : ''}, and the judge is told which pass it is. The ticked passes are averaged
          below. A pass can be judged once both of its sides are marked Finished.
        </p>
      </section>

      {tally.passes.length > 0 && (
        <section className="verdict battle-result" data-winner={tally.winner ?? ''}>
          <div className="verdict-head">
            <h2 className="t-title">
              {tally.counted === 0
                ? 'Judging…'
                : tally.winner === 'tie'
                  ? 'Level on average'
                  : tally.winner
                    ? `${who(tally.winner)} is ahead on average`
                    : 'No verdict yet'}
            </h2>
            <span className="field-note">
              {tally.counted} of {tally.passes.length} {tally.passes.length === 1 ? 'pass' : 'passes'} counted
            </span>
          </div>
          <div className="verdict-scores">
            <div>
              <span className="tw-pane-tag judge-tag-a">A</span> <b>{fmt(tally.averageA)}</b>
            </div>
            <div>
              <span className="tw-pane-tag judge-tag-b">B</span> <b>{fmt(tally.averageB)}</b>
            </div>
          </div>
          <table className="criteria-table battle-table">
            <thead>
              <tr>
                <th>Pass</th>
                <th>{who('A')}</th>
                <th>{who('B')}</th>
                <th>Verdict</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tally.passes.map((p) => (
                <tr key={p.pass} data-pass={p.pass + 1}>
                  <td>Pass {p.pass + 1}</td>
                  <td className="num">{fmt(p.overallA)}</td>
                  <td className="num">{fmt(p.overallB)}</td>
                  <td>{p.running ? 'Judging…' : p.winner ? WON[p.winner] : 'No verdict'}</td>
                  <td>
                    <button className="link-btn" onClick={() => void useJudge.getState().open(p.judgmentId)}>
                      Read the report
                    </button>
                  </td>
                </tr>
              ))}
              {tally.counted > 1 && (
                <tr className="battle-average">
                  <td>Average</td>
                  <td className="num">{fmt(tally.averageA)}</td>
                  <td className="num">{fmt(tally.averageB)}</td>
                  <td>
                    {tally.winsA}–{tally.winsB}
                    {tally.drawn ? ` · ${tally.drawn} too close` : ''}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {tally.notes.length > 0 && (
            <ul className="battle-notes">
              {tally.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tally.counted > 0 && (
        <table className="criteria-table">
          <thead>
            <tr>
              <th>Criterion{tally.counted > 1 ? ' (averaged)' : ''}</th>
              <th>Weight</th>
              <th>A</th>
              <th>B</th>
            </tr>
          </thead>
          <tbody>
            {tally.criteria.map((c) => (
              <tr key={c.id} className={c.A === null && c.B === null ? 'criterion-na' : ''}>
                <td>{c.name}</td>
                <td className="num">{c.weight}</td>
                {(['A', 'B'] as const).map((side) => (
                  <td key={side}>
                    <div className="score">
                      <div className="score-track">
                        <div className={`score-fill score-${side.toLowerCase()}`} style={{ width: `${c[side] === null ? 0 : (c[side] as number) * 10}%` }} />
                      </div>
                      <span className="score-num">{fmt(c[side])}</span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
