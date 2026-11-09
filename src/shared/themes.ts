// Every theme Tasogare ships. The colours themselves are tokens in styles/themes.css; this list is
// what the pickers, the command menu and the window frame read.

export interface ThemeInfo {
  id: string
  name: string
  note: string
  /** The picker swatch: the theme's sky (the stylesheet adds its sun and ground), and its three accents. */
  swatch: string
  dots: [string, string, string]
  /** Window frame: the title bar overlay's background and its button symbols. */
  night: string
  symbol: string
}

export const THEMES = [
  {
    id: 'twilight',
    name: 'Twilight',
    note: 'Blue dusk, iris and a warm horizon.',
    swatch: 'linear-gradient(180deg, #14173a 0%, #2c2152 45%, #6b3a52 100%)',
    dots: ['#9497ff', '#c4a0ff', '#ffb48a'],
    night: '#0b0d1c',
    symbol: '#a6abd8'
  },
  {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    note: 'Deep violet with magenta and pink.',
    swatch: 'radial-gradient(circle at 80% 0%, #3a1a5e, transparent 65%), linear-gradient(180deg, #0c0614, #33124a)',
    dots: ['#b07cff', '#f07cff', '#ff8fc8'],
    night: '#0c0614',
    symbol: '#c2b3dc'
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    note: 'Black and green, like an old terminal.',
    swatch: 'repeating-linear-gradient(0deg, #3dff8f14 0 1px, transparent 1px 3px), radial-gradient(circle at 80% 0%, #0f3a22, #030604 70%)',
    dots: ['#3dff8f', '#b6ff5c', '#4de8e0'],
    night: '#030604',
    symbol: '#9fd1ae'
  },
  {
    id: 'nightshade',
    name: 'Nightshade',
    note: 'Black with royal purple and lavender.',
    swatch: 'radial-gradient(circle 1px at 14% 22%, #e0b3ff 99%, transparent), radial-gradient(circle 1px at 38% 12%, #f1edffb0 99%, transparent), radial-gradient(circle 1px at 58% 30%, #a78bfa 99%, transparent), radial-gradient(circle 1px at 27% 40%, #e0b3ff80 99%, transparent), radial-gradient(circle at 80% 0%, #2d1a55, #07050b 70%)',
    dots: ['#a78bfa', '#8f73ff', '#e0b3ff'],
    night: '#07050b',
    symbol: '#bdb2de'
  },
  {
    id: 'ember',
    name: 'Ember',
    note: 'Black and red, with orange and gold.',
    swatch: 'radial-gradient(90% 70% at 50% 110%, #6a160d, transparent 75%), radial-gradient(circle at 85% 0%, #3d0e0e, transparent 60%), #0a0505',
    dots: ['#ff5a4f', '#ff9a4d', '#ffcf5c'],
    night: '#0a0505',
    symbol: '#e0b8b0'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    note: 'Near-black navy, ice blue and a soft violet.',
    swatch: 'radial-gradient(circle 1px at 12% 20%, #e8ecf6 99%, transparent), radial-gradient(circle 1px at 30% 38%, #7fd6e8b0 99%, transparent), radial-gradient(circle 1px at 46% 14%, #b9c8ff 99%, transparent), radial-gradient(circle 1px at 62% 34%, #e8ecf680 99%, transparent), radial-gradient(circle 1px at 22% 8%, #e8ecf690 99%, transparent), linear-gradient(180deg, #05070d, #16223f)',
    dots: ['#7aa2ff', '#b39dff', '#7fd6e8'],
    night: '#05070d',
    symbol: '#a3adc4'
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    note: 'Hot pink, cyan and a yellow sun on deep purple.',
    swatch: 'linear-gradient(180deg, #0d0221 0%, #3d0a3d 50%, #b0185a 100%)',
    dots: ['#ff2e97', '#2de2e6', '#ffd319'],
    night: '#0d0221',
    symbol: '#e0b8f2'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    note: 'Northern lights: green and violet over dark teal.',
    swatch: 'radial-gradient(circle 1px at 16% 18%, #e6fff8b0 99%, transparent), radial-gradient(circle 1px at 72% 12%, #e6fff890 99%, transparent), radial-gradient(60% 34% at 30% 34%, #4cf2c240, transparent 100%), radial-gradient(50% 30% at 76% 22%, #9d7bff4d, transparent 100%), radial-gradient(90% 60% at 20% 0%, #1f6f5c, transparent 70%), #03100f',
    dots: ['#4cf2c2', '#9d7bff', '#5ec8ff'],
    night: '#03100f',
    symbol: '#a7d9cc'
  },
  {
    id: 'campfire',
    name: 'Campfire',
    note: 'Warm amber and gold, embers in the dark.',
    swatch: 'radial-gradient(90% 80% at 50% 110%, #7a3a12, #110b07 75%)',
    dots: ['#ff9f43', '#ffcf6e', '#ff6b4a'],
    night: '#110b07',
    symbol: '#e3c3a2'
  },
  {
    id: 'moonlit',
    name: 'Moonlit Paper',
    note: 'Light: warm paper, ink and a dawn sky.',
    swatch: 'linear-gradient(180deg, #ddd6f3 0%, #f0e2ee 55%, #fbd9c2 100%)',
    dots: ['#4146c8', '#7140bf', '#a5481a'],
    night: '#ebe8f1',
    symbol: '#4a4666'
  },
  {
    id: 'contrast',
    name: 'High contrast',
    note: 'Black and white with yellow, for the clearest reading.',
    swatch: '#000',
    dots: ['#ffd60a', '#5ce1ff', '#ff8c42'],
    night: '#000000',
    symbol: '#ffffff'
  }
] as const satisfies readonly ThemeInfo[]

export type Theme = (typeof THEMES)[number]['id']

export const isTheme = (id: unknown): id is Theme => THEMES.some((t) => t.id === id)
export const themeInfo = (id: string): ThemeInfo => THEMES.find((t) => t.id === id) ?? THEMES[0]
