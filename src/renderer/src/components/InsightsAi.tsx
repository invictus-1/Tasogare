import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiState, InsightsSummary, StoryAnalysis, StoryEstimate, StoryFileState, StoryPlan } from '@shared/insights'
import { formatCost } from '@shared/pricing'
import { useInsights, type InsightsPage } from '../insightsStore'
import { modelName, optionsFor, useStore } from '../store'
import { BulbIcon, ChevronDown, ChevronRight, HistoryIcon, SparkIcon, StopIcon, TargetIcon } from './Icons'
import { ReportsPage as Reports } from './InsightsReports'

// The AI pages of Writer insights: story analysis, focus and insights. Nothing runs until asked,
// and the page says what will be sent where before it is.

const PALETTE = ['#e48ef5', '#9d7bf5', '#38d4e6', '#f5c76a', '#a3e635', '#f472b6', '#b4a2ff', '#7c5cf2', '#c084fc', '#22d3ee', '#fbbf24', '#fb7185']
const ago = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function useAi(): AiState | null {
  return useInsights((s) => s.ai)
}

/** Which model the AI pages use, and how hard it thinks. */
function ModelBar({ ai, sends }: { ai: AiState; sends: string }) {
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const visible = models.filter((m) => !m.hidden || (m.providerId === ai.config.providerId && m.id === ai.config.modelId))
  const options = optionsFor(models, providers, ai.config.providerId, ai.config.modelId)
  const provider = providers.find((p) => p.id === ai.config.providerId)
  const set = (patch: Partial<AiState['config']>): void => void window.twilight.setAiConfig({ ...ai.config, ...patch }).then((state) => useInsights.setState({ ai: state }))
  return (
    <div className="ai-bar">
      <label className="ai-field">
        <span>Model</span>
        <select
          value={`${ai.config.providerId}::${ai.config.modelId}`}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split('::')
            set({ providerId, modelId, effort: null })
          }}
        >
          {!visible.some((m) => m.providerId === ai.config.providerId && m.id === ai.config.modelId) && (
            <option value={`${ai.config.providerId}::${ai.config.modelId}`}>{modelName(models, ai.config.modelId)}</option>
          )}
          {visible.map((m) => (
            <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {options.efforts.length > 0 && (
        <label className="ai-field">
          <span>Effort</span>
          <select value={ai.config.effort ?? ''} onChange={(e) => set({ effort: e.target.value || null })}>
            <option value="">{options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'}</option>
            {options.efforts.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="ai-sends">
        Sends {sends} to {provider?.name ?? ai.config.providerId}. Nothing runs until you press the button.
      </p>
    </div>
  )
}

function RunState({ ai, kind }: { ai: AiState; kind: 'story' | 'focus' | 'notes' }) {
  const r = ai.running
  if (r?.kind === kind) {
    const pct = r.total ? Math.round((r.done / r.total) * 100) : 0
    return (
      <div className="ai-progress">
        <div className="ai-progress-track">
          <span style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
        <span className="field-note">{r.total > 1 ? `${r.done} of ${r.total} calls` : 'Waiting for the model…'}</span>
        <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => void window.twilight.stopAi()}>
          <StopIcon size={14} />
          Stop
        </button>
      </div>
    )
  }
  return ai.error ? <div className="tw-msg-error">{ai.error}</div> : null
}

function Head({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <header className="ins-head">
      <div>
        <h2 className="ins-title">{title}</h2>
        <p className="ins-sub">{sub}</p>
      </div>
      {children}
    </header>
  )
}

/** Earlier results of one kind: pick one to read it again, or remove it. */
function History<T extends { at: number; model: string }>(props: {
  items: T[]
  viewing: number | null
  onView: (at: number | null) => void
  onForget: (at: number) => void
  describe?: (item: T) => string
}) {
  const { items, viewing } = props
  if (items.length < 2) return null
  const models = useStore.getState().models
  const viewed = items.find((i) => i.at === viewing)
  return (
    <div className="ai-history">
      <label className="ai-history-pick">
        <HistoryIcon size={14} />
        <span>Earlier results</span>
        <select value={viewing ?? items[0].at} onChange={(e) => props.onView(Number(e.target.value) === items[0].at ? null : Number(e.target.value))}>
          {items.map((item, i) => (
            <option key={item.at} value={item.at}>
              {i === 0 ? 'Latest · ' : ''}
              {ago(item.at)} · {modelName(models, item.model)}
              {props.describe ? ` · ${props.describe(item)}` : ''}
            </option>
          ))}
        </select>
      </label>
      {viewed && viewed.at !== items[0].at && (
        <span className="ai-history-viewing">
          Viewing an earlier result.
          <button className="link-btn" onClick={() => props.onView(null)}>
            Back to the latest
          </button>
          <button
            className="link-btn danger-text"
            onClick={() => {
              props.onForget(viewed.at)
              props.onView(null)
            }}
          >
            Remove it
          </button>
        </span>
      )}
    </div>
  )
}

const forget = (kind: 'story' | 'focus' | 'notes', at: number): void =>
  void window.twilight.forgetAiResult(kind, at).then((state) => useInsights.setState({ ai: state }))

// ——— Story analysis ———

function Donut({ parts }: { parts: { name: string; percent: number }[] }) {
  const r = 70
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 200 200" role="img" aria-label="Content breakdown">
        {parts.map((p, i) => {
          const len = (p.percent / 100) * c
          const seg = (
            <circle
              key={p.name}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="28"
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            >
              <title>{`${p.name}: ${p.percent.toFixed(1)}%`}</title>
            </circle>
          )
          offset += len
          return seg
        })}
      </svg>
      <ul className="donut-legend">
        {parts.map((p, i) => (
          <li key={p.name}>
            <span className="donut-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
            {p.name} <b>{p.percent.toFixed(1)}%</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tags({ tags }: { tags: StoryAnalysis['tags'] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="tag-groups">
      {tags.map((t) => (
        <div key={t.name} className={`tag-group ${open === t.name ? 'open' : ''}`}>
          <button className="tag-head" aria-expanded={open === t.name} onClick={() => setOpen(open === t.name ? null : t.name)}>
            {open === t.name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t.name}
            <span className="tag-count">{t.subtags.length}</span>
          </button>
          {open === t.name && (
            <div className="word-chips tag-subs">
              {t.subtags.map((s) => (
                <span key={s} className="word-chip">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const docName = (path: string): string => path.replace(/\.md$/i, '')
const listed = (names: string[], max = 6): string => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '))

/** What a result covers, in a few words: the folder, one document, or some of them. */
function covers(r: StoryAnalysis): string {
  if (!r.files) return r.scope ? docName(r.scope) : 'the folder'
  if (r.files.length === 1) return docName(r.files[0].path)
  const total = r.files.length + (r.leftOut?.length ?? 0)
  return r.files.length === total ? `all ${total} files` : `${r.files.length} of ${total} files`
}

/** A result, with what it covers: the files a model would not read and the ones left out can be chosen from here. */
function StoryResult({ r, onChoose }: { r: StoryAnalysis; onChoose: (paths: string[]) => void }) {
  const models = useStore((s) => s.models)
  const closing = modelName(models, r.model)
  const readBy = [...new Set((r.files ?? []).flatMap((f) => f.models).filter(Boolean).map((m) => modelName(models, m)))]
  const who = readBy.length > 1 || (readBy.length === 1 && readBy[0] !== closing) ? `read by ${readBy.join(' and ')}` : closing
  const covered = (r.files ?? []).map((f) => f.path)
  const missed = (r.files ?? []).filter((f) => f.read < f.words)
  const left = r.leftOut ?? []
  return (
    <>
      <p className="ins-note">
        {r.mode === 'deep' ? 'Deep scan' : 'Quick sample'} of {r.words.toLocaleString()} words{r.files ? ` in ${covers(r)}` : ''} · {who} · {ago(r.at)}
        {r.costUsd !== null ? ` · ${formatCost(r.costUsd)}` : ''}
      </p>
      {(missed.length > 0 || left.length > 0 || r.note) && (
        <div className="story-covers">
          {missed.length > 0 && (
            <p className="story-missed">
              <b>Not read:</b> {listed(missed.map((f) => (f.read ? `${docName(f.path)} (${(f.words - f.read).toLocaleString()} of ${f.words.toLocaleString()} words)` : docName(f.path))))}.{' '}
              {missed.find((f) => f.error)?.error}{' '}
              <button className="link-btn" title="Chooses these files again. Pick another model if this one will not read them: a deep scan then reads only what is missing." onClick={() => onChoose(covered)}>
                Try again
              </button>
            </p>
          )}
          {left.length > 0 && (
            <p>
              <b>Left out:</b> {listed(left.map(docName))}.{' '}
              <button className="link-btn" title="Chooses them along with the files already covered. A deep scan then reads only them, with the model you pick." onClick={() => onChoose([...covered, ...left])}>
                Add back
              </button>
            </p>
          )}
          {r.note && (
            <p>
              <b>Your note:</b> {r.note}
            </p>
          )}
        </div>
      )}
      {r.summary && (
        <section className="ins-card">
          <h3 className="ins-card-title">In short</h3>
          <p className="ai-prose">{r.summary}</p>
          {r.tone && <p className="ai-prose ai-tone">{r.tone}</p>}
        </section>
      )}
      <div className="ins-two">
        <section className="ins-card">
          <h3 className="ins-card-title">Content breakdown</h3>
          <Donut parts={r.breakdown} />
        </section>
        <section className="ins-card">
          <h3 className="ins-card-title">Genres</h3>
          <ol className="word-bars genre-bars">
            {r.genres.map((g) => (
              <li key={g.name}>
                <span className="word-bars-word">{g.name}</span>
                <span className="word-bars-track">
                  <span style={{ width: `${Math.min(100, g.percent)}%` }} />
                </span>
                <span className="word-bars-n">{Math.round(g.percent)}%</span>
              </li>
            ))}
          </ol>
          {r.tags.length > 0 && (
            <>
              <h3 className="ins-card-title">Tags</h3>
              <p className="ins-card-note">Click one for its subcategories.</p>
              <Tags tags={r.tags} />
            </>
          )}
        </section>
      </div>
      {r.themes.length > 0 && (
        <section className="ins-card">
          <h3 className="ins-card-title">Themes</h3>
          <div className="theme-grid">
            {r.themes.map((t) => (
              <article key={t.name} className="theme-card">
                <h4>{t.name}</h4>
                <p>{t.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/** How much of a document a deep scan has read, in a few words. */
function fileState(f: StoryFileState, by: string): { label: string; tone: 'read' | 'part' | 'none' | 'failed'; title?: string } {
  if (!f.parts) return { label: f.words ? '' : 'Empty', tone: 'none' }
  if (f.read === f.parts) return { label: `Read by ${by}`, tone: 'read' }
  if (f.read) return { label: `Part read: ${f.read} of ${f.parts}`, tone: 'part', title: f.error ?? 'It has changed since it was read, or part of it has not been read yet' }
  return f.error ? { label: "Couldn't be read", tone: 'failed', title: f.error } : { label: 'Not read', tone: 'none' }
}

function StoryPage({ ai, s }: { ai: AiState; s: InsightsSummary }) {
  const models = useStore((st) => st.models)
  const [plan, setPlan] = useState<StoryPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [own, setOwn] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const card = useRef<HTMLElement>(null)
  const busy = !!ai.running
  const skipped = (ai.config.skip ?? []).join('\n')
  const skip = useMemo(() => new Set(skipped ? skipped.split('\n') : []), [skipped])
  // The folder's documents: from the plan once it is in, from the tracker's own list until then.
  const docs: StoryFileState[] = plan?.files ?? s.perFile.map((f) => ({ path: f.path, words: f.words, parts: 0, read: 0, models: [] }))
  const chosen = docs.filter((d) => !skip.has(d.path)).map((d) => d.path)
  const chosenKey = chosen.join('\n')
  const files = skip.size ? chosen : null
  // The page shows the latest analysis, whatever it covered; which files are ticked only decides
  // what the next one reads.
  const latest = ai.history.story[0] ?? null
  const result = (viewing && ai.history.story.find((r) => r.at === viewing)) || latest
  useEffect(() => {
    setViewing(null)
    setNote('')
  }, [latest?.at])
  useEffect(() => {
    let live = true
    void window.twilight.planStory(files, { own }).then((p) => live && setPlan(p))
    return () => {
      live = false
    }
  }, [chosenKey, skip.size, own, ai.config.modelId, ai.running === null, s.scannedAt])

  const saveConfig = (patch: Partial<AiState['config']>): void =>
    void window.twilight.setAiConfig({ ...ai.config, ...patch }).then((state) => useInsights.setState({ ai: state }))
  /** Ticks exactly these documents; the rest are left out until ticked again. */
  const choose = (paths: string[]): void => {
    const keep = new Set(paths)
    saveConfig({ skip: docs.map((d) => d.path).filter((p) => !keep.has(p)) })
  }
  const fromResult = (paths: string[]): void => {
    choose(paths)
    setOpen(true)
    card.current?.scrollIntoView({ block: 'nearest' })
  }
  const run = (mode: 'quick' | 'deep'): void => {
    void window.twilight.runStory(mode, files, { own, note }).catch((err) => useStore.getState().setError(errText(err)))
  }
  const cost = (e: StoryEstimate | null): string =>
    e?.costUsd == null ? 'cost unknown for this model' : e.costUsd === 0 ? 'free on a local model' : `about ${formatCost(e.costUsd)}`

  const total = docs.length
  const label = !total
    ? 'No documents yet'
    : !chosen.length
      ? 'No files chosen'
      : chosen.length === 1
        ? docName(chosen[0])
        : chosen.length === total
          ? `All ${total} files`
          : `${chosen.length} of ${total} files`
  const unread = docs.filter((d) => d.parts > 0 && d.read < d.parts).map((d) => d.path)
  const othersRead = !!plan?.files.some((f) => !skip.has(f.path) && f.models.some((m) => m !== ai.config.modelId))
  const quick = plan?.quick ?? null
  const deep = plan?.deep ?? null
  return (
    <>
      <Head title="Story analysis" sub="What your story is made of: content, genres, tags and themes, read by a model you choose" />
      <ModelBar ai={ai} sends={chosen.length === 1 ? 'this document' : 'the documents you choose'} />
      <section className="ins-card ai-run" ref={card}>
        <div className="ai-run-row">
          <button className="story-pick" aria-expanded={open} aria-label="Files to analyse" title="Choose which files are analysed" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{label}</span>
          </button>
          <button className="tw-btn tw-btn-primary" disabled={busy || !chosen.length} onClick={() => run('quick')}>
            <SparkIcon size={15} />
            Quick sample
          </button>
          <button className="tw-btn" disabled={busy || !chosen.length} onClick={() => run('deep')}>
            Deep scan
          </button>
          <label className="ai-parallel" title="How many parts of a deep scan are read at the same time. More is faster; some providers limit how many requests you can make at once.">
            <span>Calls at once</span>
            <input
              type="number"
              min={1}
              max={10}
              value={ai.config.parallel}
              disabled={busy}
              onChange={(e) => saveConfig({ parallel: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
        </div>
        {open && (
          <div className="story-files">
            <div className="story-files-pick">
              <span>Choose</span>
              <button className="link-btn" disabled={busy} onClick={() => choose(docs.map((d) => d.path))}>
                All
              </button>
              <button className="link-btn" disabled={busy} onClick={() => choose([])}>
                None
              </button>
              <button className="link-btn" disabled={busy || !plan} title="Only the files a deep scan has not read, or has not read all of" onClick={() => choose(unread)}>
                Not read yet
              </button>
            </div>
            <ul className="story-file-list">
              {docs.map((f) => {
                const st = fileState(f, f.models.map((m) => modelName(models, m)).join(' and '))
                return (
                  <li key={f.path}>
                    <label className="story-file">
                      <input
                        type="checkbox"
                        checked={!skip.has(f.path)}
                        disabled={busy}
                        onChange={() => choose(skip.has(f.path) ? [...chosen, f.path] : chosen.filter((p) => p !== f.path))}
                      />
                      <span className="story-file-name">{docName(f.path)}</span>
                      {f.note && (
                        <span className="tw-badge" title={`Your note: ${f.note}`}>
                          Note
                        </span>
                      )}
                      <span className="story-file-words">{f.words.toLocaleString()} words</span>
                      <span className={`story-file-state story-${st.tone}`} title={st.title}>
                        {st.label}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <label className="story-note">
          <span>Note for the model (optional)</span>
          <textarea
            rows={2}
            maxLength={1000}
            value={note}
            disabled={busy}
            placeholder="Anything it should know about these files: where they sit in the story, why they are here"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {(own || othersRead) && (
          <label className="check story-own">
            <input type="checkbox" checked={own} disabled={busy} onChange={(e) => setOwn(e.target.checked)} />
            Read everything with {modelName(models, ai.config.modelId)}, even what another model has read
          </label>
        )}
        <p className="field-note">
          Quick sample: one call reading {quick ? `${quick.words > 25000 ? 'about 25,000 words of excerpts' : `all ${quick.words.toLocaleString()} words`}` : '…'}, {cost(quick)}. Deep scan:{' '}
          {deep ? `${deep.calls} call${deep.calls === 1 ? '' : 's'} over ${deep.words.toLocaleString()} words` : '…'}
          {deep && deep.cached > 0 ? ` (${deep.cached} parts already read, never billed twice)` : ''}, {cost(deep)}, {ai.config.parallel} at a time; the same model writes the final themes. A part a
          model will not read is set aside, and the rest is still analysed.{note.trim() ? ' Your note goes with what is read in this run.' : ''}
        </p>
        <RunState ai={ai} kind="story" />
      </section>
      <History
        items={ai.history.story}
        viewing={viewing}
        onView={setViewing}
        onForget={(at) => forget('story', at)}
        describe={(r) => `${r.mode === 'deep' ? 'deep scan' : 'quick sample'} · ${covers(r)}`}
      />
      {result ? <StoryResult r={result} onChoose={fromResult} /> : !busy && <div className="ins-empty">No analysis yet. A quick sample is a good start.</div>}
    </>
  )
}

// ——— Focus ———

function FocusPage({ ai }: { ai: AiState }) {
  const [viewing, setViewing] = useState<number | null>(null)
  useEffect(() => setViewing(null), [ai.focus?.at])
  const f = (viewing && ai.history.focus.find((r) => r.at === viewing)) || ai.focus
  return (
    <>
      <Head title="Focus" sub="A few things to work on, chosen from your prose numbers and what you wrote most recently">
        <button className="tw-btn tw-btn-primary" disabled={!!ai.running} onClick={() => void window.twilight.runFocus().catch((e) => useStore.getState().setError(errText(e)))}>
          <TargetIcon size={15} />
          {f ? 'Look again' : 'Find my focus'}
        </button>
      </Head>
      <ModelBar ai={ai} sends="your prose numbers and about 3,600 words from your most recently changed documents" />
      <RunState ai={ai} kind="focus" />
      <History items={ai.history.focus} viewing={viewing} onView={setViewing} onForget={(at) => forget('focus', at)} />
      {f ? (
        <>
          <p className="ins-note">
            {modelName(useStore.getState().models, f.model)} · {ago(f.at)}
          </p>
          {f.strength && (
            <section className="ins-card focus-strength">
              <h3 className="ins-card-title">Already working</h3>
              <p className="ai-prose">{f.strength}</p>
            </section>
          )}
          <div className="theme-grid focus-grid">
            {f.areas.map((a, i) => (
              <article key={a.title} className="focus-card">
                <span className="focus-n">{i + 1}</span>
                <h4>{a.title}</h4>
                <p>{a.why}</p>
                {a.evidence.map((q) => (
                  <blockquote key={q}>{q}</blockquote>
                ))}
                {a.exercise && (
                  <p className="focus-try">
                    <b>Try:</b> {a.exercise}
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      ) : (
        !ai.running && <div className="ins-empty">Nothing yet. Press "Find my focus" to get a few concrete things to work on.</div>
      )}
    </>
  )
}

// ——— Insights ———

function NotesPage({ ai }: { ai: AiState }) {
  const [viewing, setViewing] = useState<number | null>(null)
  useEffect(() => setViewing(null), [ai.notes?.at])
  const n = (viewing && ai.history.notes.find((r) => r.at === viewing)) || ai.notes
  return (
    <>
      <Head title="Insights" sub="What your numbers say about how you write: habits, rhythms and trends">
        <button className="tw-btn tw-btn-primary" disabled={!!ai.running} onClick={() => void window.twilight.runNotes().catch((e) => useStore.getState().setError(errText(e)))}>
          <BulbIcon size={15} />
          {n ? 'Refresh' : 'Read my numbers'}
        </button>
      </Head>
      <ModelBar ai={ai} sends="your statistics only (no manuscript text)" />
      <RunState ai={ai} kind="notes" />
      <History items={ai.history.notes} viewing={viewing} onView={setViewing} onForget={(at) => forget('notes', at)} />
      {n ? (
        <>
          <p className="ins-note">
            {modelName(useStore.getState().models, n.model)} · {ago(n.at)}
          </p>
          <div className="theme-grid">
            {n.observations.map((o) => (
              <article key={o.title} className="theme-card">
                <h4>{o.title}</h4>
                <p>{o.text}</p>
              </article>
            ))}
          </div>
          {n.nextStep && (
            <section className="ins-card focus-strength">
              <h3 className="ins-card-title">For the week ahead</h3>
              <p className="ai-prose">{n.nextStep}</p>
            </section>
          )}
        </>
      ) : (
        !ai.running && <div className="ins-empty">Nothing yet. Only your statistics are sent, never your writing.</div>
      )}
    </>
  )
}

export function AiPage({ page, s }: { page: InsightsPage; s: InsightsSummary }) {
  const ai = useAi()
  if (!ai) return <div className="ins-empty">Loading…</div>
  if (page === 'story') return <StoryPage ai={ai} s={s} />
  if (page === 'focus') return <FocusPage ai={ai} />
  return <NotesPage ai={ai} />
}

export const ReportsPage = Reports
