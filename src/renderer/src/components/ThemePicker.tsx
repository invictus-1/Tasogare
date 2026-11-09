import { THEMES } from '@shared/themes'
import { loadCustom } from '../customTheme'
import type { Theme } from '../theme'
import type { CSSProperties } from 'react'

/** A swatch's colours, for the scene the stylesheet draws on it. */
const scene = (sky: string, ground: string, dots: readonly string[]): CSSProperties =>
  ({ background: sky, '--sw-ground': ground, '--sw-a': dots[0], '--sw-b': dots[1], '--sw-c': dots[2] }) as CSSProperties

/** Every theme as a swatch card, and (in Settings) your own; used in Settings and in the welcome. */
export function ThemePicker({ value, onPick, className = '', custom = false }: { value: Theme; onPick: (theme: Theme) => void; className?: string; custom?: boolean }) {
  const mine = loadCustom()
  return (
    <div className={`theme-picker ${className}`} role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} className="theme-option" data-theme-id={t.id} aria-pressed={value === t.id} onClick={() => onPick(t.id)}>
          <span className="theme-swatch" style={scene(t.swatch, t.night, t.dots)}>
            {t.dots.map((d) => (
              <span key={d} style={{ background: d }} />
            ))}
          </span>
          <b>{t.name}</b>
          <small>{t.note}</small>
        </button>
      ))}
      {custom && (
        <button className="theme-option" data-theme-id="custom" aria-pressed={value === 'custom'} onClick={() => onPick('custom')}>
          <span className="theme-swatch" style={scene(mine.ground, mine.ground, [mine.actions, mine.tools, mine.writing])}>
            {[mine.actions, mine.tools, mine.writing].map((d, i) => (
              <span key={i} style={{ background: d }} />
            ))}
          </span>
          <b>Your own</b>
          <small>Pick a ground and three accents.</small>
        </button>
      )}
    </div>
  )
}
