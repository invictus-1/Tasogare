import { useState } from 'react'
import type { Rubric, RubricCriterion } from '@shared/judge'
import { useJudge } from '../judgeStore'
import { useStore } from '../store'
import { CloseIcon, ExportIcon, FolderPlusIcon, PenIcon, PlusIcon, TrashIcon } from './Icons'

// Rubrics, wherever they are chosen or kept: the editor, the actions beside a rubric picker (in a
// new comparison and a new battle), and the list in Settings.

const failed = (err: unknown): void =>
  useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

/** Picks a rubric file and adds it; tells the caller which one it was. */
async function importRubric(onPick?: (id: string) => void): Promise<void> {
  try {
    const result = await window.twilight.importRubric()
    if (!result) return
    useJudge.getState().setRubrics(result.rubrics)
    onPick?.(result.id)
  } catch (err) {
    failed(err)
  }
}

/**
 * Edits a rubric of your own, or copies the built-in one. `onPick` is told the rubric to use
 * afterwards: the one saved, or General fiction when it was deleted.
 */
export function RubricEditor({ rubric, isNew, onClose, onPick }: { rubric: Rubric; isNew?: boolean; onClose: () => void; onPick?: (id: string) => void }) {
  const copy = rubric.builtIn
  const [draft, setDraft] = useState<Rubric>(copy ? { ...rubric, id: `custom-${Date.now()}`, name: `${rubric.name} (my copy)`, builtIn: false } : rubric)
  const setCriterion = (i: number, patch: Partial<RubricCriterion>): void =>
    setDraft((d) => ({ ...d, criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog rubric-dialog" role="dialog" aria-modal="true" aria-label="Rubric">
        <div className="panel-head">
          <h2 className="t-title">{copy ? 'Copy rubric' : isNew ? 'New rubric' : 'Edit rubric'}</h2>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {copy && <p className="field-note">Built-in rubrics stay as they are; changes save as your own copy.</p>}
        <label className="field">
          <span className="field-label">Name</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        {draft.criteria.map((c, i) => (
          <div key={i} className="criterion">
            <div className="criterion-head">
              <input value={c.name} placeholder="Criterion" onChange={(e) => setCriterion(i, { name: e.target.value })} />
              <label className="criterion-weight">
                weight
                <input type="number" min={0.5} max={5} step={0.5} value={c.weight} onChange={(e) => setCriterion(i, { weight: Number(e.target.value) || 1 })} />
              </label>
              <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Remove ${c.name}`} onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}>
                <TrashIcon size={14} />
              </button>
            </div>
            <textarea rows={3} value={c.guide} placeholder="What the judge should look for" onChange={(e) => setCriterion(i, { guide: e.target.value })} />
          </div>
        ))}
        <button
          className="tw-btn tw-btn-sm"
          onClick={() => setDraft({ ...draft, criteria: [...draft.criteria, { id: `c${Date.now()}`, name: '', weight: 1, guide: '' }] })}
        >
          <PlusIcon size={14} />
          Add criterion
        </button>
        <div className="dialog-actions">
          {!copy && !isNew && (
            <button
              className="tw-btn tw-btn-ghost danger-text"
              onClick={async () => {
                useJudge.getState().setRubrics(await window.twilight.deleteRubric(rubric.id))
                onPick?.('general-fiction')
                onClose()
              }}
            >
              Delete rubric
            </button>
          )}
          <span className="tw-spacer" />
          <button className="tw-btn tw-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="tw-btn tw-btn-primary rubric-save"
            disabled={!draft.name.trim() || draft.criteria.length === 0 || draft.criteria.some((c) => !c.name.trim())}
            onClick={async () => {
              const cleaned = { ...draft, criteria: draft.criteria.map((c) => ({ ...c, id: c.id || c.name.toLowerCase().replace(/\W+/g, '-') })) }
              useJudge.getState().setRubrics(await window.twilight.saveRubric(cleaned))
              onPick?.(cleaned.id)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * What can be done with the rubric chosen in a picker: change it (or copy the built-in one), save
 * it to a file, or add one from a file. `locked` is a rubric held as an earlier comparison used it,
 * which is not the saved one and so is not edited from here.
 */
export function RubricActions({ rubric, locked, onPick }: { rubric: Rubric | undefined; locked?: boolean; onPick: (id: string) => void }) {
  const [editing, setEditing] = useState<Rubric | null>(null)
  return (
    <span className="chip-actions rubric-actions">
      {rubric && !locked && (
        <button type="button" className="chip-action rubric-edit" onClick={() => setEditing(rubric)}>
          <PenIcon size={12} />
          {rubric.builtIn ? 'View or copy' : 'Edit'}
        </button>
      )}
      {rubric && !locked && !rubric.builtIn && (
        <button type="button" className="chip-action" title="Save this rubric to a file" onClick={() => void window.twilight.exportRubric(rubric.id).catch(() => undefined)}>
          <ExportIcon size={12} />
          Export
        </button>
      )}
      <button type="button" className="chip-action" title="Add a rubric from a file" onClick={() => void importRubric(onPick)}>
        <FolderPlusIcon size={12} />
        Import
      </button>
      {editing && <RubricEditor rubric={editing} onClose={() => setEditing(null)} onPick={onPick} />}
    </span>
  )
}

const BLANK: Rubric = { id: '', name: '', description: '', criteria: [{ id: '', name: '', weight: 1, guide: '' }] }

/** Settings → Judge rubrics: every rubric, changed, copied, added and moved between installs here. */
export function RubricSettings() {
  const rubrics = useJudge((s) => s.rubrics)
  const [editing, setEditing] = useState<{ rubric: Rubric; isNew?: boolean } | null>(null)
  return (
    <section className="settings-card library-card" data-kind="rubrics" aria-label="Rubrics">
      <div className="panel-head">
        <h3 className="t-heading">
          Rubrics <span className="rm-heading-count">{rubrics.length}</span>
        </h3>
        <button className="tw-btn tw-btn-sm" title="Add a rubric from a file" onClick={() => void importRubric()}>
          <FolderPlusIcon size={14} />
          Import
        </button>
        <button className="tw-btn tw-btn-sm rubric-new" onClick={() => setEditing({ rubric: { ...BLANK, id: `custom-${Date.now()}` }, isNew: true })}>
          <PlusIcon size={14} />
          New rubric
        </button>
      </div>
      <p className="field-note">
        What the Judge scores against, criterion by criterion. The built-in rubric stays as it is; copy it to make your own. A comparison keeps the rubric as it was when it was judged, so changing one
        here never changes an earlier result.
      </p>
      {rubrics.map((r) => (
        <div key={r.id} className="library-item" data-rubric={r.id}>
          <div className="library-text">
            <span className="library-name">
              {r.name} {r.builtIn && <span className="tw-badge">Built in</span>}
            </span>
            <span className="library-meta">
              <span className="library-preview">
                {r.criteria.length} criteria: {r.criteria.map((c) => c.name).join(', ')}
              </span>
            </span>
          </div>
          <span className="library-actions">
            <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setEditing({ rubric: r })}>
              <PenIcon size={14} />
              {r.builtIn ? 'View or copy' : 'Edit'}
            </button>
            {!r.builtIn && (
              <button className="tw-btn tw-btn-ghost tw-btn-sm" title="Save this rubric to a file" onClick={() => void window.twilight.exportRubric(r.id).catch(() => undefined)}>
                <ExportIcon size={14} />
                Export
              </button>
            )}
          </span>
        </div>
      ))}
      {editing && <RubricEditor rubric={editing.rubric} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </section>
  )
}
