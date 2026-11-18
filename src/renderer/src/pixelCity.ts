// The cyberpunk horizon, drawn as pixel art: three layers of towers in the theme's colours (far
// ones lost in haze, near ones dark), lit windows, neon signs mounted on their buildings (rooftop
// boards on legs, screens on a wall, blade signs on brackets, shop fronts at street level), rooftop
// aerials, and the wet street below mirroring it all: a true reflection, wobbling a little more
// with every row, its lights smeared down the water. It's laid out at one canvas pixel per PX
// screen pixels and scaled up with hard edges. Seeded, so the city is the same every time; drawn
// once per size, theme and time of day, and kept, so opening another chat only copies it.

export const PX = 3

export type RGB = [number, number, number]
export interface Palette {
  night: RGB
  dusk: RGB
  iris: RGB
  horizon: RGB
  surface: RGB
  ink: RGB
}

/** Where the moving parts sit, in canvas pixels: signs that flicker and aerials that blink. */
export interface CityLayout {
  w: number
  h: number
  signs: { x: number; y: number; w: number; h: number; color: string }[]
  lights: { x: number; y: number }[]
}

export const css = (c: RGB, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`
export const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB
export const MAGENTA: RGB = [255, 63, 190]
export const CYAN: RGB = [63, 232, 255]
export const BLACK: RGB = [0, 0, 0]
export const light = (c: RGB): number => c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1

/** The theme's colours as the sky has them (any CSS colour, read back through a 1×1 canvas). */
export function readPalette(el: Element): Palette {
  const style = getComputedStyle(el)
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const read = (name: string, fallback: string): RGB => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = fallback
    probe.fillStyle = style.getPropertyValue(name).trim() || fallback
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  return {
    night: read('--night', '#0b0b22'),
    dusk: read('--dusk', '#7a4bd8'),
    iris: read('--iris', '#9497ff'),
    horizon: read('--horizon', '#ff8a4c'),
    surface: read('--surface', '#15163a'),
    ink: read('--ink', '#e8e8ff')
  }
}

export function seeded(seed: number): () => number {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** How often a scene was painted afresh or copied from the kept one, for the scroll test: neither should happen while a chat scrolls. */
export const scenePaints = { fresh: 0, copied: 0 }
;(globalThis as { twilightScenePaints?: typeof scenePaints }).twilightScenePaints = scenePaints

let kept: { key: string; image: HTMLCanvasElement; layout: CityLayout } | null = null
// What each canvas holds now: one that already shows this painting is left untouched.
const painted = new WeakMap<HTMLCanvasElement, { key: string; layout: CityLayout }>()

interface Layer {
  min: number
  max: number
  lo: number
  hi: number
  body: RGB
  rim: number
  lit: number
  windows: RGB[]
  /** How often a building carries each kind of sign. */
  blades: number
  boards: number
  screens: number
  shops: number
  aerials: number
  /** Tanks, vents and pipes on the roofs. */
  clutter: number
}

/**
 * Paints the city into `canvas` (sized w × h canvas pixels, the horizon at row `hy`) and says where
 * its signs and lights are. The same size, colours and time reuse the last painting.
 */
export function paintCity(canvas: HTMLCanvasElement, w: number, h: number, hy: number, p: Palette, time: string): CityLayout {
  const key = `${w}x${h}@${hy}:${time}:${Object.values(p).flat().join(',')}`
  const had = painted.get(canvas)
  if (had?.key === key) return had.layout
  canvas.width = w
  canvas.height = h
  // The row where the street begins, for anything that reads the painting back (the tests do).
  canvas.dataset.kerb = String(hy)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  if (kept?.key === key) {
    ctx.drawImage(kept.image, 0, 0)
    painted.set(canvas, { key, layout: kept.layout })
    scenePaints.copied++
    return kept.layout
  }
  scenePaints.fresh++
  const rand = seeded(2077)
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]
  const neon: RGB[] = [mix(p.iris, MAGENTA, 0.45), mix(p.ink, CYAN, 0.65), mix(p.horizon, MAGENTA, 0.2), mix(p.iris, CYAN, 0.35)]
  const day = time === 'day'
  // On a light theme the city is an ink wash: far towers pale, near ones deep, windows lit in paper.
  const paper = light(p.night) > light(p.ink)
  const dark = paper ? p.ink : BLACK
  const layout: CityLayout = { w, h, signs: [], lights: [] }
  const rect = (x: number, y: number, rw: number, rh: number, c: RGB, a = 1): void => {
    ctx.fillStyle = css(c, a)
    ctx.fillRect(x, y, rw, rh)
  }
  // Where light sits above the street (windows, signs), so the wet ground can smear it downward.
  const lit = new Uint8Array(w * Math.max(1, hy))
  const glow = (x: number, y: number, rw: number, rh: number, c: RGB, a = 1): void => {
    rect(x, y, rw, rh, c, a)
    for (let yy = Math.max(0, y); yy < Math.min(hy, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) lit[yy * w + xx] = 1
  }
  const unlit = (x: number, y: number, rw: number, rh: number, c: RGB, a = 1): void => {
    rect(x, y, rw, rh, c, a)
    for (let yy = Math.max(0, y); yy < Math.min(hy, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) lit[yy * w + xx] = 0
  }
  /** A lit face (a board or a screen): two neons top to bottom, with a few dark marks for what it shows. */
  const face = (x: number, y: number, fw: number, fh: number, c1: RGB, c2: RGB, marks: number[]): void => {
    for (let yy = 0; yy < fh; yy++) glow(x, y + yy, fw, 1, mix(c1, c2, yy / Math.max(1, fh - 1)), 0.92)
    marks.forEach((m, i) => {
      const mw = 1 + Math.floor(m * Math.max(1, fw - 3))
      const mx = x + 1 + Math.floor(((m * 7.3) % 1) * Math.max(1, fw - mw - 1))
      const my = y + 1 + ((i * 2) % Math.max(1, fh - 2))
      if (fw > 4 && fh > 2) rect(mx, my, Math.min(mw, fw - 2), 1, mix(c2, dark, 0.55), 0.7)
    })
  }

  // One layer of towers. The buildings go up first, then everything mounted on them, so a sign is
  // never cut through by the next building along.
  const layer = (o: Layer): void => {
    const mounted: (() => void)[] = []
    const edge = mix(o.body, p.ink, paper ? 0.1 : 0.14)
    for (let x = -4; x < w; ) {
      const bw = Math.round(o.min + rand() * (o.max - o.min))
      const tall = rand() > 0.92 ? 1.25 : 1
      const bh = Math.min(hy - 2, Math.round(hy * (o.lo + rand() * (o.hi - o.lo)) * tall))
      const top = hy - bh
      rect(x, top, bw, bh, o.body)
      // Rim light on the side facing the sunset, a pale ledge along the roof, and a set-back tier on some.
      rect(x, top, 1, bh, mix(o.body, p.horizon, o.rim))
      rect(x + 1, top, bw - 1, 1, edge)
      let roofX = x
      let roofW = bw
      let roofTop = top
      const tiered = rand() < 0.4 && bw > 5
      if (tiered) {
        const tw = Math.max(2, Math.round(bw * (0.4 + rand() * 0.3)))
        const th = Math.round(2 + rand() * 6)
        roofX = x + Math.round((bw - tw) / 2)
        roofW = tw
        roofTop = top - th
        rect(roofX, roofTop, tw, th, o.body)
        rect(roofX, roofTop, 1, th, mix(o.body, p.horizon, o.rim))
        rect(roofX + 1, roofTop, tw - 1, 1, edge)
      }
      // Windows, in one of three habits: scattered, whole floors, or lit shafts.
      const habit = rand()
      const windowAlpha = (): number => (day ? 0.35 : 0.55 + rand() * 0.45)
      if (habit < 0.6) {
        for (let yy = top + 2; yy < hy - 1; yy += 2) {
          for (let xx = x + 1; xx < x + bw - 1; xx += 2) if (rand() < o.lit) glow(xx, yy, 1, 1, pick(o.windows), windowAlpha())
        }
      } else if (habit < 0.85) {
        for (let yy = top + 2; yy < hy - 1; yy += 2) {
          const floorLit = rand() < o.lit * 2.2
          for (let xx = x + 1; xx < x + bw - 1; xx++) if (floorLit ? rand() < 0.7 : rand() < o.lit * 0.25) glow(xx, yy, 1, 1, pick(o.windows), windowAlpha())
        }
      } else {
        for (let xx = x + 2; xx < x + bw - 1; xx += 3) {
          if (rand() > o.lit * 3.5) continue
          const from = top + 2 + Math.floor(rand() * bh * 0.4)
          const c = pick(o.windows)
          for (let yy = from; yy < hy - 2; yy++) if (rand() < 0.8) glow(xx, yy, 1, 1, c, day ? 0.3 : 0.5)
        }
      }
      // An aerial with a light that blinks.
      if (rand() < o.aerials && bh > hy * 0.3) {
        const ah = Math.round(3 + rand() * 7)
        const ax = roofX + Math.floor(roofW / 2)
        rect(ax, roofTop - ah - 4, 1, ah + 4, o.body)
        layout.lights.push({ x: ax, y: roofTop - ah - 4 })
      }
      // Roof clutter: a tank on legs, a vent box, a pipe up the side.
      if (rand() < o.clutter && !tiered && bw > 6) {
        const kind = rand()
        const cx = x + 1 + Math.floor(rand() * (bw - 5))
        if (kind < 0.4) {
          rect(cx, top - 4, 3, 3, o.body)
          rect(cx, top - 1, 1, 1, o.body)
          rect(cx + 2, top - 1, 1, 1, o.body)
          rect(cx, top - 4, 3, 1, edge)
        } else if (kind < 0.75) {
          rect(cx, top - 2, 2, 2, o.body)
          rect(cx, top - 2, 2, 1, edge)
        } else {
          rect(cx, top - 3, 1, 3, o.body)
          rect(cx, top - 3, 2, 1, o.body)
        }
      }

      // Every random number a sign needs is drawn now; the sign itself is painted after the layer.
      const body = o.body
      // A blade sign: off the side of the wall on two brackets, its "letters" left as gaps.
      if (rand() < o.blades && bh > 12) {
        const sh = Math.round(5 + rand() * Math.min(12, bh - 9))
        const left = rand() < 0.5
        const sx = left ? x - 3 : x + bw + 1
        const sy = top + 3 + Math.round(rand() * Math.max(1, bh - sh - 8))
        const c = pick(neon)
        mounted.push(() => {
          const bracket = mix(body, p.ink, 0.25)
          rect(left ? x - 1 : x + bw, sy, 1, 1, bracket)
          rect(left ? x - 1 : x + bw, sy + sh - 1, 1, 1, bracket)
          unlit(sx, sy - 1, 2, sh + 2, mix(body, dark, 0.45))
          for (let yy = 0; yy < sh; yy++) if (yy % 3 !== 2) glow(sx, sy + yy, 2, 1, c, 0.95)
          layout.signs.push({ x: sx, y: sy, w: 2, h: sh, color: css(c) })
        })
      }
      // A rooftop board: no wider than its roof, standing on two legs.
      if (rand() < o.boards && !tiered && bw > 6) {
        const bbw = Math.max(5, Math.min(bw - 1, Math.round(bw * (0.6 + rand() * 0.35))))
        const bbh = Math.round(3 + rand() * 3)
        const bx = x + Math.floor((bw - bbw) / 2)
        const by = top - bbh - 3
        const [c1, c2] = [pick(neon), pick(neon)]
        const marks = [rand(), rand(), rand()]
        if (by > 2) {
          mounted.push(() => {
            rect(bx + 1, by + bbh, 1, 3, body)
            rect(bx + bbw - 2, by + bbh, 1, 3, body)
            unlit(bx - 1, by - 1, bbw + 2, bbh + 2, mix(body, dark, 0.5))
            face(bx, by, bbw, bbh, c1, c2, marks)
            layout.signs.push({ x: bx, y: by, w: bbw, h: bbh, color: css(c1) })
          })
        }
      }
      // A screen on the wall itself, framed, high on the face.
      if (rand() < o.screens && bw > 7 && bh > 16) {
        const sw = bw - 2 - 2 * Math.floor(rand() * 2)
        const sh = Math.round(4 + rand() * 4)
        const sx = x + Math.floor((bw - sw) / 2)
        const sy = top + 3 + Math.round(rand() * bh * 0.25)
        const [c1, c2] = [pick(neon), pick(neon)]
        const marks = [rand(), rand(), rand(), rand()]
        mounted.push(() => {
          unlit(sx - 1, sy - 1, sw + 2, sh + 2, mix(body, dark, 0.5))
          face(sx, sy, sw, sh, c1, c2, marks)
          layout.signs.push({ x: sx, y: sy, w: sw, h: sh, color: css(c1) })
        })
      }
      // A shop front at street level: a strip of neon over a lit window, an awning's shadow between.
      if (rand() < o.shops && bw > 6) {
        const sw = Math.round(4 + rand() * Math.min(6, bw - 6))
        const sx = x + 1 + Math.floor(rand() * Math.max(1, bw - sw - 1))
        const c = pick(neon)
        const inside = pick(o.windows)
        const door = rand() < 0.5 ? 0 : sw - 1
        mounted.push(() => {
          glow(sx, hy - 6, sw, 1, c, 0.95)
          unlit(sx, hy - 5, sw, 1, mix(body, dark, 0.5))
          glow(sx, hy - 4, sw, 3, inside, day ? 0.25 : 0.42)
          // The door, darker than the window beside it.
          unlit(sx + door, hy - 4, 1, 3, mix(body, inside, 0.25))
        })
      }
      x += bw + Math.round(rand() * 2)
    }
    mounted.forEach((paint) => paint())
  }

  const haze = (from: number, to: number, c: RGB, a: number): void => {
    for (let y = from; y < to; y++) rect(0, y, w, 1, c, a * ((y - from) / Math.max(1, to - from)))
  }

  layer({ min: 4, max: 12, lo: 0.4, hi: 0.95, body: mix(p.night, p.dusk, paper ? 0.2 : day ? 0.6 : 0.42), rim: 0.12, lit: 0.05, windows: [mix(p.horizon, p.ink, 0.5)], blades: 0.04, boards: 0, screens: 0, shops: 0, aerials: 0.35, clutter: 0 })
  haze(Math.round(hy * 0.3), hy, p.dusk, 0.35)
  layer({ min: 6, max: 15, lo: 0.25, hi: 0.68, body: paper ? mix(p.night, p.dusk, 0.42) : mix(p.night, p.surface, 0.3), rim: 0.18, lit: 0.16, windows: paper ? [p.surface, mix(p.surface, p.horizon, 0.3), mix(p.surface, CYAN, 0.4)] : [mix(p.horizon, p.ink, 0.35), mix(p.ink, CYAN, 0.3), p.ink], blades: 0.3, boards: 0.14, screens: 0.16, shops: 0, aerials: 0.25, clutter: 0.2 })
  haze(Math.round(hy * 0.6), hy, p.night, 0.3)
  layer({ min: 8, max: 18, lo: 0.1, hi: 0.36, body: paper ? mix(mix(p.night, p.dusk, 0.64), p.ink, 0.18) : mix(p.night, BLACK, 0.35), rim: 0.22, lit: 0.1, windows: paper ? [p.surface, mix(p.surface, p.horizon, 0.3)] : [mix(p.horizon, p.ink, 0.25), mix(p.iris, p.ink, 0.4)], blades: 0.22, boards: 0.3, screens: 0.2, shops: 0.4, aerials: 0.1, clutter: 0.45 })

  // ——— The wet street: the city mirrored row by row ———
  // Each row below the kerb shows the row as far above it, nudged sideways a little more the
  // further down it is. Where there is no building it gives back the sky's low glow, so the dark
  // towers stand in it as dark shapes; lights fade slower than walls and smear down the water.
  const ground = paper ? mix(p.night, p.dusk, 0.3) : mix(p.night, BLACK, 0.4)
  const floor = h - hy
  if (floor > 0 && hy > 0) {
    const src = ctx.getImageData(0, 0, w, hy).data
    const out = ctx.createImageData(w, floor)
    const px = out.data
    const sky = paper ? mix(p.night, p.dusk, 0.16) : mix(mix(p.night, p.dusk, day ? 0.5 : 0.32), p.horizon, time === 'night' ? 0.03 : 0.1)
    const wet = seeded(909)
    const smear = new Float32Array(w * 4)
    for (let d = 0; d < floor; d++) {
      const t = d / floor
      const sy = hy - 1 - d
      const depth = Math.min(1, t * 2.4) ** 0.8
      const base = [0, 1, 2].map((i) => sky[i] + (ground[i] - sky[i]) * depth)
      const sway = Math.round(Math.sin(d * 0.61 + Math.sin(d * 0.17) * 1.8) * Math.min(2.2, d * 0.045))
      const fade = Math.max(0, 1 - t * 1.25)
      // Every few rows a ripple turns away and gives back a little less.
      const ripple = d > 2 && d % 3 === 2 ? 0.8 : 1
      const wallK = 0.8 * fade ** 1.1 * ripple
      const lightK = 0.95 * fade ** 0.7 * ripple
      for (let x = 0; x < w; x++) {
        let [r, g, b] = base
        const sx = Math.max(0, Math.min(w - 1, x + sway))
        if (sy >= 0) {
          const i = (sy * w + sx) * 4
          const a = src[i + 3] / 255
          if (a > 0) {
            const isLight = lit[sy * w + sx] === 1
            const k = (isLight ? lightK : wallK) * a
            r += (src[i] - r) * k
            g += (src[i + 1] - g) * k
            b += (src[i + 2] - b) * k
            if (isLight) {
              smear[x * 4] = src[i]
              smear[x * 4 + 1] = src[i + 1]
              smear[x * 4 + 2] = src[i + 2]
              smear[x * 4 + 3] = 1
            }
          }
        }
        const s = smear[x * 4 + 3]
        if (s > 0.03) {
          const k = s * 0.2 * fade
          r += smear[x * 4] * k
          g += smear[x * 4 + 1] * k
          b += smear[x * 4 + 2] * k
          smear[x * 4 + 3] = s * 0.84
        }
        const o = (d * w + x) * 4
        px[o] = Math.min(255, r)
        px[o + 1] = Math.min(255, g)
        px[o + 2] = Math.min(255, b)
        px[o + 3] = 255
      }
      // Broken water: short stretches where a ripple shows only the sky's glow, more of them further out.
      if (d > 1) {
        for (let n = Math.floor(w * (0.006 + t * 0.03)); n > 0; n--) {
          const from = Math.floor(wet() * w)
          const len = Math.round(2 + wet() * (4 + t * 16))
          for (let x = from; x < Math.min(w, from + len); x++) {
            const o = (d * w + x) * 4
            for (let c = 0; c < 3; c++) px[o + c] += (base[c] - px[o + c]) * 0.65
          }
        }
      }
    }
    ctx.putImageData(out, 0, hy)
    // A neon kerb along the waterline, and the far water lost in the dark.
    rect(0, hy, w, 1, mix(p.horizon, MAGENTA, 0.25), 0.6)
    haze(hy + Math.round(floor * 0.35), h, ground, 0.7)
  }

  const image = document.createElement('canvas')
  image.width = w
  image.height = h
  image.getContext('2d')!.drawImage(canvas, 0, 0)
  kept = { key, image, layout }
  painted.set(canvas, { key, layout })
  return layout
}

/** A flying car, facing right, as a small picture: body, cockpit, head and tail lights, underglow. */
export function carSprite(body: RGB, glow: RGB): string {
  const art = ['...bbbbb....', '..bwwwbbbb..', 'rbbbbbbbbbbh', '.bbbbbbbbbb.', '..nnnnnnnn..']
  const c = document.createElement('canvas')
  c.width = art[0].length
  c.height = art.length
  const ctx = c.getContext('2d')!
  const colours: Record<string, string> = { b: css(body), w: css(CYAN, 0.9), r: css([255, 60, 90]), h: css([255, 255, 240]), n: css(glow, 0.7) }
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    if (colours[ch]) {
      ctx.fillStyle = colours[ch]
      ctx.fillRect(x, y, 1, 1)
    }
  }))
  return c.toDataURL()
}

export const carColours = (p: Palette): { body: RGB; glow: RGB }[] => [
  { body: mix(p.night, p.ink, 0.25), glow: mix(p.iris, MAGENTA, 0.45) },
  { body: mix(p.night, p.dusk, 0.5), glow: mix(p.ink, CYAN, 0.65) },
  { body: mix(p.night, p.horizon, 0.3), glow: mix(p.horizon, MAGENTA, 0.2) }
]
