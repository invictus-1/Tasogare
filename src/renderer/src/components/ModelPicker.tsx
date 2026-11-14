import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePane } from '../pane'
import { modelName, paneOf, useStore } from '../store'
import { CheckIcon, ChevronDown, ChipIcon, CloudIcon, RefreshIcon, SearchIcon } from './Icons'

/** Closes a menu on a press anywhere outside its root while it is open. */
function useOutside(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  return root
}

/**
 * The menu of models: a box to filter them, the list by provider, and the way to add more. `all`
 * lists every model of the providers that are on, the hidden ones too; otherwise only the ones
 * chosen for the picker.
 */
function ModelMenu(props: {
  placement: 'up' | 'down'
  selected: { providerId?: string; modelId?: string } | null | undefined
  all?: boolean
  onPick: (providerId: string, modelId: string) => void
  onClose: () => void
  children?: ReactNode
}) {
  const { selected } = props
  const [filter, setFilter] = useState('')
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return providers
      .filter((p) => p.enabled)
      .map((p) => ({
        provider: p,
        models: models.filter((m) => m.providerId === p.id && (props.all || !m.hidden) && (!f || `${m.name} ${m.id}`.toLowerCase().includes(f)))
      }))
      .filter((g) => g.models.length)
  }, [providers, models, filter, props.all])
  const settings = (): void => {
    props.onClose()
    // Model providers is the top of the Models settings, where an API is added; models to run on
    // this PC are the page under it.
    useStore.getState().setSettingsOpen(true, 'providers')
  }

  return (
    <div className={`tw-menu picker-menu picker-${props.placement}`} role="listbox">
      <div className="picker-search">
        <input
          autoFocus
          placeholder="Filter models"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), props.onClose())}
        />
        <button
          type="button"
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label="Refresh model list"
          title="Refresh model list"
          onClick={() => void useStore.getState().refreshModels(true)}
        >
          <RefreshIcon size={14} />
        </button>
      </div>
      <div className="picker-list">
        {groups.map(({ provider, models: list }) => (
          <div key={provider.id}>
            <div className="tw-menu-label">
              {provider.name} · {provider.kind === 'anthropic' ? 'API' : list[0]?.local ? 'Local' : 'API'}
            </div>
            {list.map((m) => {
              const chosen = selected?.modelId === m.id && selected?.providerId === m.providerId
              return (
                <div key={`${m.providerId}:${m.id}`} className="tw-menu-item" role="option" aria-selected={chosen} onClick={() => props.onPick(m.providerId, m.id)}>
                  {m.local ? <ChipIcon className="muted" /> : <CloudIcon className="muted" />}
                  <span className="picker-name">{m.name}</span>
                  <span className="tw-meta">{chosen ? <CheckIcon className="iris" /> : m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : null}</span>
                </div>
              )
            })}
          </div>
        ))}
        {groups.length === 0 &&
          (filter.trim() && models.some((m) => props.all || !m.hidden) ? (
            <div className="picker-empty">No model matches “{filter.trim()}”.</div>
          ) : (
            <div className="picker-empty">
              {models.some((m) => m.hidden) ? 'No models chosen yet. Tick the ones you want in ' : 'No models found. Add an Anthropic API key, or start Ollama or LM Studio, in '}
              <button type="button" className="link-btn" onClick={settings}>
                Settings → Model providers
              </button>
              .
            </div>
          ))}
      </div>
      <div className="tw-menu-item picker-find" role="button" tabIndex={0} onClick={settings} onKeyDown={(e) => e.key === 'Enter' && settings()}>
        <SearchIcon className="muted" />
        <span className="picker-name">Add or find models…</span>
      </div>
      {props.children}
    </div>
  )
}

/**
 * The model chip and its menu. Opens upward from the composer, downward from a header. With
 * scope "defaults" it picks the default model (used by new chats and the writing tools).
 */
export function ModelPicker({ placement = 'up', scope = 'chat' }: { placement?: 'up' | 'down'; scope?: 'chat' | 'defaults' }) {
  const pane = usePane()
  const [open, setOpen] = useState(false)
  const root = useOutside(open, () => setOpen(false))
  const models = useStore((s) => s.models)
  const settings = useStore((s) => (s.current && scope === 'chat' ? paneOf(s.current, pane).settings : s.defaults))
  const started = useStore((s) => (s.current && scope === 'chat' ? paneOf(s.current, pane).path.length > 0 : false))

  const pick = (providerId: string, modelId: string): void => {
    if (scope === 'defaults') void useStore.getState().setDefaultModel(providerId, modelId)
    else void useStore.getState().updateSettings({ providerId, modelId }, pane)
    setOpen(false)
  }

  return (
    <div className="picker" ref={root}>
      <button className="tw-chip" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Model">
        {modelName(models, settings?.modelId)}
        <ChevronDown size={14} className="chip-chevron" />
      </button>
      {open && (
        <ModelMenu placement={placement} selected={settings} onPick={pick} onClose={() => setOpen(false)}>
          {started && <div className="picker-note">Switching models mid-chat starts a fresh prompt cache.</div>}
        </ModelMenu>
      )}
    </div>
  )
}

/**
 * A model chosen in a form (the Judge's judge and writers): the box reads like the other fields,
 * and opens the same menu as the chat's picker, so a long list can be filtered by typing. It lists
 * every model of the providers that are on.
 */
export function ModelField(props: { providerId: string; modelId: string; label: string; onPick: (providerId: string, modelId: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useOutside(open, () => setOpen(false))
  const models = useStore((s) => s.models)
  return (
    <div className="picker model-field" ref={root}>
      <button type="button" className="model-field-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={props.label} onClick={() => setOpen((o) => !o)}>
        <span className="picker-name">{modelName(models, props.modelId)}</span>
        <ChevronDown size={14} className="chip-chevron" />
      </button>
      {open && (
        <ModelMenu
          placement="down"
          all
          selected={props}
          onClose={() => setOpen(false)}
          onPick={(providerId, modelId) => {
            props.onPick(providerId, modelId)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
