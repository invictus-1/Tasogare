// The space horizon: a colony on a cratered moon under a ringed giant. A nebula and its stars, the
// giant with its bands, storms and rings (their shadow on it, its shadow on them), a small far
// moon, a ring station, and below the horizon a plain of craters and rocks lit low from the sun,
// with the colony on the right: glass domes with a town inside, a corridor, habitats, fuel tanks,
// a comms tower, a field of solar panels and a landing pad. All of it is painted once per size,
// theme and time of day, in the theme's own colours, and kept; what moves (ships, a launch, the
// rover, beacons) is laid over it by Horizons and only ever moves by transform or opacity.

import { BLACK, css, CYAN, light, MAGENTA, mix, scenePaints, seeded, type Palette, type RGB } from './pixelCity'

/** Where the moving parts go, in the painting's own pixels (w × h, as given). */
export interface SpaceLayout {
  w: number
  h: number
  /** Lights that blink: the comms tower's, the station's, the pad's corners. */
  beacons: { x: number; y: number }[]
  /** The landing pad's middle, where a shuttle lifts off. */
  pad: { x: number; y: number }
  /** The rover's run along its road: where its wheels start, and how far it goes across and down. */
  rover: { x: number; y: number; dx: number; dy: number }
  /** How big things are drawn (1 at a horizon about 560px down, less in a narrow pane). */
  scale: number
}

const WHITE: RGB = [255, 255, 255]
let kept: { key: string; image: HTMLCanvasElement; layout: SpaceLayout } | null = null
// What each canvas holds now: one that already shows this painting is left untouched (a scene
// scrolled away and back asks again, and resetting a large canvas mid-scroll would drop a frame).
const painted = new WeakMap<HTMLCanvasElement, { key: string; layout: SpaceLayout }>()

/**
 * Paints the scene into `canvas`, w × h CSS pixels with the horizon at `hy`, at up to twice that
 * in real pixels for a sharp screen. The same size, colours and time reuse the last painting.
 */
export function paintSpace(canvas: HTMLCanvasElement, w: number, h: number, hy: number, p: Palette, time: string): SpaceLayout {
  // Sharp on a dense screen, but never a painting so large that keeping it is a burden.
  const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(5_000_000 / Math.max(1, w * h)))
  const key = `${Math.round(w * ratio)}x${Math.round(h * ratio)}@${hy}:${time}:${Object.values(p).flat().join(',')}`
  const had = painted.get(canvas)
  if (had?.key === key) return had.layout
  canvas.width = Math.round(w * ratio)
  canvas.height = Math.round(h * ratio)
  const ctx = canvas.getContext('2d')!
  if (kept?.key === key) {
    ctx.drawImage(kept.image, 0, 0)
    painted.set(canvas, { key, layout: kept.layout })
    scenePaints.copied++
    return kept.layout
  }
  scenePaints.fresh++
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  const day = time === 'day'
  const night = time === 'night'
  // On a light theme the scene is an ink wash: pale sky things, deep ground.
  const paper = light(p.night) > light(p.ink)
  const dark = paper ? p.ink : BLACK
  const floor = h - hy
  const s = Math.max(0.42, Math.min(1.5, hy / 560, w / 1180))
  const layout: SpaceLayout = { w, h, beacons: [], pad: { x: 0, y: 0 }, rover: { x: 0, y: 0, dx: 0, dy: 0 }, scale: s }
  const TAU = Math.PI * 2
  const fill = (c: RGB, a = 1): void => void (ctx.fillStyle = css(c, a))
  const stroke = (c: RGB, a = 1, width = 1): void => {
    ctx.strokeStyle = css(c, a)
    ctx.lineWidth = width
  }
  const disc = (x: number, y: number, r: number): void => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }
  /** A soft round glow of one colour, added to what's there. */
  const glow = (x: number, y: number, r: number, c: RGB, a: number, squash = 1): void => {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1, squash)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, css(c, a))
    g.addColorStop(0.5, css(c, a * 0.42))
    g.addColorStop(1, css(c, 0))
    ctx.fillStyle = g
    ctx.fillRect(-r, -r, r * 2, r * 2)
    ctx.restore()
  }
  // The sun sits on the horizon in the middle; everything is lit from there.
  const sunX = w / 2
  const hull = mix(p.night, p.ink, paper ? 0.22 : 0.34)
  const hullDark = mix(hull, dark, 0.5)
  const hullLit = mix(hull, p.horizon, night ? 0.25 : 0.5)
  const warm = mix(p.horizon, p.ink, 0.45)
  const cool = mix(p.ink, CYAN, 0.45)
  const shadow = paper ? mix(p.ink, p.dusk, 0.3) : mix(p.night, BLACK, 0.55)

  // ——— The nebula: clouds of the theme's colours across the top, dust lanes cut through them ———
  {
    const rand = seeded(4242)
    const strength = day ? 0.45 : paper ? 0.8 : 1.3
    const tints = [mix(p.iris, MAGENTA, 0.4), mix(p.iris, CYAN, 0.45), mix(p.dusk, p.horizon, 0.5), p.iris, mix(p.dusk, MAGENTA, 0.3)]
    ctx.save()
    ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
    for (let i = 0; i < 34; i++) {
      const t = i / 33
      const x = w * (0.26 + t * 0.8) + (rand() - 0.5) * hy * 0.34
      const y = hy * (0.4 - t * 0.3 + Math.sin(t * 5.2) * 0.07) + (rand() - 0.5) * hy * 0.24
      const r = hy * (0.12 + rand() * 0.24)
      glow(x, y, r, tints[Math.floor(rand() * tints.length)], (0.03 + rand() * 0.055) * strength, 0.6 + rand() * 0.5)
    }
    // A brighter heart where the clouds are thickest.
    glow(w * 0.84, hy * 0.16, hy * 0.2, mix(p.ink, p.iris, 0.5), 0.07 * strength)
    glow(w * 0.58, hy * 0.2, hy * 0.14, mix(p.ink, MAGENTA, 0.4), 0.05 * strength)
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 9; i++) {
      const x = w * (0.34 + rand() * 0.66)
      const y = hy * (0.08 + rand() * 0.34)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-0.5 + rand() * 0.6)
      glow(0, 0, hy * (0.1 + rand() * 0.14), BLACK, 0.5, 0.22 + rand() * 0.2)
      ctx.restore()
    }
    ctx.restore()
    // Its stars: a thick scatter, a few with a colour or a flare.
    if (!day) {
      for (let i = 0; i < 190; i++) {
        const t = rand()
        const x = w * (0.26 + t * 0.8) + (rand() - 0.5) * hy * 0.5
        const y = hy * (0.38 - t * 0.3) + (rand() - 0.5) * hy * 0.5
        if (y < 2 || y > hy * 0.8) continue
        const big = rand() > 0.94
        fill(rand() > 0.8 ? mix(p.ink, rand() > 0.5 ? CYAN : p.horizon, 0.45) : p.ink, 0.25 + rand() * 0.6)
        disc(x, y, big ? 1.3 : 0.55 + rand() * 0.4)
        if (big && rand() > 0.5) {
          stroke(p.ink, 0.35, 0.8)
          ctx.beginPath()
          ctx.moveTo(x - 6, y)
          ctx.lineTo(x + 6, y)
          ctx.moveTo(x, y - 6)
          ctx.lineTo(x, y + 6)
          ctx.stroke()
        }
      }
    }
  }

  // ——— A small far moon, a sliver of it lit ———
  {
    const r = Math.max(9, hy * 0.034)
    const x = w * 0.41
    const y = hy * 0.13
    const away = Math.atan2(y - hy, x - sunX)
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.clip()
    fill(mix(p.ink, p.dusk, 0.45))
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    fill(mix(p.dusk, p.night, 0.4), 0.55)
    disc(x - r * 0.25, y - r * 0.2, r * 0.22)
    disc(x + r * 0.3, y + r * 0.25, r * 0.16)
    disc(x + r * 0.05, y - r * 0.5, r * 0.12)
    // Its night side, away from the sun.
    const g = ctx.createLinearGradient(x - Math.cos(away) * r * 0.5, y - Math.sin(away) * r * 0.5, x + Math.cos(away) * r, y + Math.sin(away) * r)
    g.addColorStop(0, css(shadow, 0))
    g.addColorStop(0.45, css(shadow, 0.75))
    g.addColorStop(1, css(shadow, 0.95))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.restore()
  }

  // ——— The giant and its rings ———
  {
    const R = Math.min(hy * 0.27, w * 0.13)
    // Clear of the words in the middle of the sky: in a narrow pane it slides partly off the left edge.
    const cx = Math.max(R * 0.25, Math.min(w * 0.15, w / 2 - 200 - R))
    const cy = hy * 0.37
    const tilt = -0.32
    const squash = 0.27
    const toSun = Math.atan2(hy - cy, sunX - cx)
    const ux = Math.cos(toSun)
    const uy = Math.sin(toSun)
    const ringA = mix(p.ink, p.horizon, 0.35)
    const ringB = mix(p.iris, p.dusk, 0.4)
    // One half of the rings (the far half goes behind the giant, the near half in front). The
    // giant's shadow lies across the far half, away from the sun: outside it they are drawn in
    // full, inside it all but dark. Clipped passes straight onto the painting.
    const rings = (front: boolean): void => {
      for (const inShadow of front ? [false] : [false, true]) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(toSun + Math.PI)
        ctx.beginPath()
        if (!inShadow || front) ctx.rect(-R * 4, -R * 4, R * 8, R * 8)
        if (!front) ctx.rect(R * 0.15, -R * 0.94, R * 3.6, R * 1.88)
        ctx.clip('evenodd')
        ctx.rotate(tilt - toSun - Math.PI)
        const rand = seeded(77)
        const n = Math.max(40, Math.round(R * 1.1))
        for (let i = 0; i < n; i++) {
          const t = i / n
          // Thin near the giant, a broad bright ring, a dark gap, a paler ring with a thread missing, a faint edge.
          let alpha = t < 0.12 ? 0.16 : t < 0.55 ? 0.62 : t < 0.61 ? 0.05 : t < 0.9 ? 0.44 : 0.2
          if (t > 0.78 && t < 0.795) alpha = 0.08
          alpha *= (0.7 + rand() * 0.5) * (front ? 1 : 0.82) * (day ? 0.7 : 1) * (inShadow ? 0.09 : 1)
          stroke(mix(ringA, ringB, rand()), alpha, (R * 0.92) / n + 0.35)
          ctx.beginPath()
          ctx.ellipse(0, 0, R * (1.28 + t * 0.92), R * (1.28 + t * 0.92) * squash, 0, front ? 0 : Math.PI, front ? Math.PI : TAU)
          ctx.stroke()
        }
        ctx.restore()
      }
    }
    rings(false)

    // Its air, a soft halo all round.
    ctx.save()
    ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
    const halo = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.16)
    halo.addColorStop(0, css(mix(p.iris, p.ink, 0.4), 0.3))
    halo.addColorStop(1, css(p.iris, 0))
    ctx.fillStyle = halo
    ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, TAU)
    ctx.clip()
    ctx.translate(cx, cy)
    ctx.rotate(tilt)
    const rand = seeded(1610)
    const bands = [mix(p.dusk, p.horizon, 0.42), mix(p.iris, p.ink, 0.35), mix(p.dusk, p.night, 0.25), mix(p.horizon, p.ink, 0.5), mix(p.iris, p.dusk, 0.5), mix(p.dusk, p.horizon, 0.2), mix(p.ink, p.horizon, 0.3)]
    fill(bands[0])
    ctx.fillRect(-R, -R, R * 2, R * 2)
    // Bands along its latitudes, bowed as a ball's are, their edges wandering.
    const bow = R * 0.16
    const edge = (y: number, phase: number, back: boolean): void => {
      const steps = 24
      for (let i = 0; i <= steps; i++) {
        const u = back ? 1 - i / steps : i / steps
        const x = -R + u * 2 * R
        const yy = y + bow * (1 - (x / R) ** 2) + Math.sin(u * 9 + phase) * R * 0.012 + Math.sin(u * 23 + phase * 2) * R * 0.006
        ctx.lineTo(x, yy)
      }
    }
    for (let y = -R * 1.25, i = 0; y < R; i++) {
      const bh = R * (0.05 + rand() * 0.13)
      const phase = rand() * 9
      ctx.beginPath()
      ctx.moveTo(-R, y)
      edge(y, phase, false)
      edge(y + bh, phase + 1.7, true)
      ctx.closePath()
      fill(mix(bands[(i * 3 + Math.floor(rand() * 2)) % bands.length], bands[i % bands.length], rand() * 0.5), 0.94)
      ctx.fill()
      y += bh
    }
    // Fine streaks within the bands, and a few storms.
    for (let i = 0; i < 46; i++) {
      const y = -R * 1.1 + rand() * R * 2
      stroke(rand() > 0.5 ? p.ink : p.night, 0.05 + rand() * 0.1, 0.6 + rand() * 1.2)
      ctx.beginPath()
      ctx.moveTo(-R, y)
      edge(y, rand() * 9, false)
      ctx.stroke()
    }
    const storm = (x: number, y: number, rx: number, c: RGB): void => {
      const yy = y + bow * (1 - (x / R) ** 2)
      fill(c, 0.85)
      ctx.beginPath()
      ctx.ellipse(x, yy, rx, rx * 0.42, 0, 0, TAU)
      ctx.fill()
      stroke(mix(c, p.ink, 0.5), 0.6, Math.max(0.8, R * 0.008))
      ctx.beginPath()
      ctx.ellipse(x, yy, rx * 0.62, rx * 0.24, 0, 0, TAU)
      ctx.stroke()
      stroke(mix(c, p.night, 0.4), 0.5, Math.max(0.8, R * 0.008))
      ctx.beginPath()
      ctx.ellipse(x, yy, rx * 1.3, rx * 0.6, 0, 0, TAU)
      ctx.stroke()
    }
    storm(R * 0.3, R * 0.1, R * 0.13, mix(p.horizon, MAGENTA, 0.25))
    storm(-R * 0.35, -R * 0.42, R * 0.06, mix(p.ink, p.iris, 0.3))
    storm(R * 0.05, R * 0.46, R * 0.045, mix(p.ink, p.horizon, 0.4))
    // The rings' shadow, a dark curve across its face.
    stroke(shadow, 0.34, R * 0.085)
    ctx.beginPath()
    ctx.ellipse(0, -R * 0.02, R * 1.04, R * 0.3, 0, Math.PI * 1.02, Math.PI * 1.98)
    ctx.stroke()
    stroke(shadow, 0.2, R * 0.03)
    ctx.beginPath()
    ctx.ellipse(0, -R * 0.1, R * 1.04, R * 0.34, 0, Math.PI * 1.02, Math.PI * 1.98)
    ctx.stroke()
    ctx.rotate(-tilt)
    ctx.translate(-cx, -cy)
    // Night on the side away from the sun, the edge falling into shade, a sheen where the light lands.
    const nightSide = ctx.createLinearGradient(cx + ux * R * 0.35, cy + uy * R * 0.35, cx - ux * R, cy - uy * R)
    nightSide.addColorStop(0, css(shadow, 0))
    nightSide.addColorStop(0.5, css(shadow, 0.6))
    nightSide.addColorStop(1, css(shadow, 0.95))
    ctx.fillStyle = nightSide
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
    const limb = ctx.createRadialGradient(cx + ux * R * 0.2, cy + uy * R * 0.2, R * 0.3, cx, cy, R)
    limb.addColorStop(0, css(shadow, 0))
    limb.addColorStop(0.72, css(shadow, 0))
    limb.addColorStop(1, css(shadow, 0.6))
    ctx.fillStyle = limb
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
    ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
    glow(cx + ux * R * 0.5, cy + uy * R * 0.5, R * 0.8, mix(p.ink, p.horizon, 0.3), day ? 0.1 : 0.16)
    ctx.restore()
    // A bright line of air along the lit edge.
    stroke(mix(p.ink, p.iris, 0.35), 0.55, Math.max(1, R * 0.012))
    ctx.beginPath()
    ctx.arc(cx, cy, R - 0.4, toSun - 1.25, toSun + 1.25)
    ctx.stroke()
    rings(true)
  }

  // ——— A ring station, turning somewhere overhead ———
  {
    const x = w * 0.63
    const y = hy * 0.15
    const k = s * 1.55
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.3)
    // Solar wings on the hub's two ends.
    for (const side of [-1, 1]) {
      fill(mix(mix(p.iris, CYAN, 0.4), p.night, 0.45))
      ctx.fillRect(-11 * k, side * 21 * k - 3.5 * k, 22 * k, 7 * k)
      stroke(p.ink, 0.25, 0.6)
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 4.4 * k, side * 21 * k - 3.5 * k)
        ctx.lineTo(i * 4.4 * k, side * 21 * k + 3.5 * k)
        ctx.stroke()
      }
    }
    // The far half of the ring, the hub and spokes, then the near half.
    stroke(hullDark, 1, 3.4 * k)
    ctx.beginPath()
    ctx.ellipse(0, 0, 30 * k, 10.5 * k, 0, Math.PI, TAU)
    ctx.stroke()
    fill(hull)
    ctx.fillRect(-2.6 * k, -18 * k, 5.2 * k, 36 * k)
    fill(hullLit, 0.8)
    ctx.fillRect(-2.6 * k, -18 * k, 1.2 * k, 36 * k)
    stroke(hullDark, 1, 1.2 * k)
    ctx.beginPath()
    ctx.moveTo(-30 * k, 0)
    ctx.lineTo(30 * k, 0)
    ctx.stroke()
    stroke(hull, 1, 3.4 * k)
    ctx.beginPath()
    ctx.ellipse(0, 0, 30 * k, 10.5 * k, 0, 0, Math.PI)
    ctx.stroke()
    stroke(hullLit, 0.9, 1 * k)
    ctx.beginPath()
    ctx.ellipse(0, 1.2 * k, 30 * k, 10.5 * k, 0, 0.5, 2.2)
    ctx.stroke()
    // Windows round the near half.
    for (let i = 0; i < 9; i++) {
      const a = 0.25 + i * 0.33
      fill(i % 3 === 0 ? cool : warm, day ? 0.5 : 0.95)
      ctx.fillRect(Math.cos(a) * 30 * k - 0.7 * k, Math.sin(a) * 10.5 * k - 0.7 * k, 1.4 * k, 1.4 * k)
    }
    ctx.restore()
    layout.beacons.push({ x: x + Math.sin(-0.3) * 18 * k * -1 - 0.5, y: y - Math.cos(-0.3) * 18 * k })
  }

  // ——— A drift of asteroids between the giant and the ground, each lit on its sunward side ———
  {
    const rand = seeded(515)
    for (let i = 0; i < 9; i++) {
      const x = w * (0.3 + rand() * 0.14)
      const y = hy * (0.5 + rand() * 0.2)
      const r = (2.2 + rand() ** 2 * 11) * s
      const toSun = Math.atan2(hy - y, sunX - x)
      ctx.save()
      ctx.translate(x, y)
      const spin = rand() * TAU
      ctx.rotate(spin)
      ctx.beginPath()
      const corners = 7
      const radii = Array.from({ length: corners }, () => r * (0.68 + rand() * 0.4))
      radii.forEach((rr, j) => {
        const a = (j / corners) * TAU
        if (j === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8)
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8)
      })
      ctx.closePath()
      const turned = toSun - spin
      const g = ctx.createLinearGradient(Math.cos(turned) * r, Math.sin(turned) * r, -Math.cos(turned) * r, -Math.sin(turned) * r)
      g.addColorStop(0, css(mix(mix(p.dusk, p.ink, 0.45), p.horizon, night ? 0.1 : 0.35)))
      g.addColorStop(0.45, css(mix(p.night, p.dusk, 0.5)))
      g.addColorStop(1, css(mix(p.night, dark, 0.3)))
      ctx.fillStyle = g
      ctx.fill()
      if (r > 6 * s) {
        fill(shadow, 0.45)
        disc(-r * 0.2, r * 0.1, r * 0.2)
        disc(r * 0.3, -r * 0.2, r * 0.12)
      }
      ctx.restore()
    }
  }

  // ——— A small blue world rising far to the left, half behind the hills, a crescent of it lit ———
  {
    const r = Math.max(16, hy * 0.075)
    const x = w * 0.07
    const y = hy - r * 0.35
    const toSun = Math.atan2(hy - y, sunX - x)
    ctx.save()
    ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
    glow(x, y, r * 1.5, mix(p.iris, CYAN, 0.6), 0.16)
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.clip()
    const sea = ctx.createRadialGradient(x + Math.cos(toSun) * r * 0.5, y + Math.sin(toSun) * r * 0.5, r * 0.1, x, y, r)
    sea.addColorStop(0, css(mix(mix(p.iris, CYAN, 0.65), p.ink, 0.3)))
    sea.addColorStop(1, css(mix(mix(p.iris, CYAN, 0.5), p.night, 0.45)))
    ctx.fillStyle = sea
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    // Land, and cloud across it.
    const rand = seeded(88)
    fill(mix([90, 170, 120], p.dusk, 0.35), 0.75)
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      ctx.ellipse(x + (rand() - 0.5) * r * 1.5, y + (rand() - 0.5) * r * 1.4, r * (0.14 + rand() * 0.24), r * (0.08 + rand() * 0.16), rand() * 3, 0, TAU)
      ctx.fill()
    }
    stroke(p.ink, 0.5, Math.max(1, r * 0.07))
    ctx.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
      const cy = y - r * 0.8 + i * r * 0.4
      ctx.beginPath()
      ctx.moveTo(x - r * (0.2 + rand() * 0.7), cy)
      ctx.quadraticCurveTo(x, cy + (rand() - 0.5) * r * 0.3, x + r * (0.2 + rand() * 0.7), cy + (rand() - 0.5) * r * 0.2)
      ctx.stroke()
    }
    ctx.lineCap = 'butt'
    const nightSide = ctx.createLinearGradient(x + Math.cos(toSun) * r * 0.1, y + Math.sin(toSun) * r * 0.1, x - Math.cos(toSun) * r, y - Math.sin(toSun) * r)
    nightSide.addColorStop(0, css(shadow, 0))
    nightSide.addColorStop(0.45, css(shadow, 0.7))
    nightSide.addColorStop(1, css(shadow, 0.96))
    ctx.fillStyle = nightSide
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.restore()
    stroke(mix(p.ink, CYAN, 0.5), 0.6, Math.max(1, r * 0.03))
    ctx.beginPath()
    ctx.arc(x, y, r - 0.4, toSun - 1.2, toSun + 1.2)
    ctx.stroke()
  }

  // ——— The ground: low crater-rim hills on the horizon, then the plain ———
  {
    const rand = seeded(3301)
    const rimLight = (): RGB => mix(mix(p.dusk, p.ink, 0.35), p.horizon, night ? 0.1 : 0.45)
    // Hills, lower toward the middle so the sun stands clear; each face lit or shaded by its slope.
    const hills = (seed: number, tall: number, lit: RGB, shade: RGB): void => {
      const r = seeded(seed)
      let x = -20
      let y = hy - tall * (0.3 + r() * 0.5)
      while (x < w + 20) {
        const nx = x + (18 + r() * 60) * s
        const clear = 0.25 + 0.75 * Math.min(1, Math.abs(nx - sunX) / (w * 0.22))
        const ny = hy - tall * clear * (0.15 + r() * 0.85)
        // Lit when the face looks toward the sun.
        const facesSun = nx < sunX ? ny > y : ny < y
        fill(facesSun ? lit : shade)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(nx, ny)
        ctx.lineTo(nx, hy + 2)
        ctx.lineTo(x, hy + 2)
        ctx.closePath()
        ctx.fill()
        x = nx
        y = ny
      }
    }
    hills(71, hy * 0.06, mix(mix(p.night, p.dusk, night ? 0.36 : 0.5), p.horizon, night ? 0.04 : 0.2), mix(p.night, p.dusk, night ? 0.28 : 0.4))
    hills(72, hy * 0.032, mix(mix(p.night, p.dusk, night ? 0.24 : 0.32), p.horizon, night ? 0.03 : 0.14), mix(p.night, p.dusk, night ? 0.14 : 0.2))

    const plain = ctx.createLinearGradient(0, hy, 0, h)
    plain.addColorStop(0, css(mix(mix(p.dusk, p.night, night ? 0.68 : 0.5), p.horizon, night ? 0.03 : 0.2)))
    plain.addColorStop(0.1, css(mix(p.night, p.dusk, paper ? 0.4 : night ? 0.2 : 0.3)))
    plain.addColorStop(0.5, css(mix(p.night, p.dusk, paper ? 0.3 : night ? 0.1 : 0.15)))
    plain.addColorStop(1, css(mix(p.night, dark, paper ? 0.1 : 0.3)))
    ctx.fillStyle = plain
    ctx.fillRect(0, hy, w, floor)
    // The low sun's light spilling over the horizon onto the ground.
    if (!night) {
      ctx.save()
      ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
      glow(sunX, hy, w * 0.34, p.horizon, day ? 0.1 : 0.2, (floor * 0.5) / (w * 0.34))
      ctx.restore()
    }
    // Long gentle swells in the ground, as bands of slightly lighter and darker dust.
    for (let i = 0; i < 9; i++) {
      const v = (i + 0.5) / 9
      const y = hy + floor * v ** 1.7 * 0.9
      fill(i % 2 ? p.dusk : dark, 0.05 + rand() * 0.05)
      ctx.beginPath()
      ctx.ellipse(rand() * w, y, w * (0.18 + rand() * 0.3), floor * 0.012 * (1 + v * 4), 0, 0, TAU)
      ctx.fill()
    }

    // Rilles: two long winding cracks across the plain, a lit lip along one edge.
    for (const [v, from, to] of [
      [0.34, 0.02, 0.44],
      [0.56, 0.5, 0.98]
    ]) {
      const y = hy + floor * v
      const wide = (1 + v * 3) * s
      const lines: [RGB, number, number, number][] = [
        [shadow, 0.5, 0, wide],
        [rimLight(), night ? 0.2 : 0.4, wide * 0.7, Math.max(0.7, wide * 0.3)]
      ]
      for (const [c, a, off, lw] of lines) {
        stroke(c, a, lw)
        ctx.beginPath()
        ctx.moveTo(w * from, y + off)
        for (let i = 1; i <= 12; i++) {
          const u = i / 12
          ctx.lineTo(w * (from + (to - from) * u), y + off + Math.sin(u * 9 + v * 20) * floor * 0.012 + Math.sin(u * 23) * floor * 0.005)
        }
        ctx.stroke()
      }
    }

    // Where the colony and its pad stand, kept clear of craters and rocks.
    const baseX = w * 0.765
    // The colony is drawn a third larger than the rest.
    const big = 1.3
    const baseY = hy + floor * 0.05
    const padX = w * 0.52
    const padY = hy + floor * 0.16
    const built = (x: number, y: number, r: number): boolean =>
      (x + r > baseX - 200 * big * s && x - r < baseX + 240 * big * s && y < baseY + floor * 0.2) || (Math.abs(x - padX) < 70 * s + r && Math.abs(y - padY) < 18 * s + r)

    // Craters, small and flat far off, wide near: the floor in shadow, the wall facing the sun lit,
    // the rim catching light on its sunward side and throwing shadow on the other.
    const craters: { x: number; y: number; rx: number; ry: number }[] = []
    for (let i = 0; i < 60 && craters.length < 34; i++) {
      const v = rand() ** 1.5
      const y = hy + floor * (0.035 + v * 0.8)
      const depth = (y - hy) / floor
      const rx = (5 + rand() * 24) * (0.4 + depth * 2.6) * s
      const ry = rx * (0.2 + depth * 0.2)
      const x = rand() * w
      if (built(x, y, rx) || craters.some((c) => Math.hypot((c.x - x) / (c.rx + rx), (c.y - y) / (c.ry + ry)) < 0.9)) continue
      craters.push({ x, y, rx, ry })
    }
    craters.sort((a, b) => a.y - b.y)
    for (const c of craters) {
      // The way the light travels here, in the crater's own round plan.
      const away = Math.atan2((c.y - hy) * 3.2, c.x - sunX)
      const ax = Math.cos(away)
      const ay = Math.sin(away)
      fill(shadow, 0.28)
      ctx.beginPath()
      ctx.ellipse(c.x + ax * c.rx * 0.5, c.y + ay * c.ry * 0.5, c.rx * 1.25, c.ry * 1.25, 0, 0, TAU)
      ctx.fill()
      fill(mix(p.night, p.dusk, 0.38), 0.75)
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, c.rx * 1.16, c.ry * 1.16, 0, 0, TAU)
      ctx.fill()
      stroke(rimLight(), night ? 0.4 : 0.75, Math.max(0.9, c.ry * 0.13))
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, c.rx * 1.12, c.ry * 1.12, 0, away + Math.PI - 1.15, away + Math.PI + 1.15)
      ctx.stroke()
      fill(paper ? mix(p.dusk, p.ink, 0.2) : mix(p.night, dark, 0.35), paper ? 0.5 : 0.92)
      ctx.beginPath()
      ctx.ellipse(c.x, c.y + c.ry * 0.07, c.rx * 0.9, c.ry * 0.9, 0, 0, TAU)
      ctx.fill()
      stroke(mix(p.dusk, p.horizon, night ? 0.12 : 0.5), night ? 0.3 : 0.6, Math.max(1, c.ry * 0.24))
      ctx.beginPath()
      ctx.ellipse(c.x, c.y + c.ry * 0.07, c.rx * 0.8, c.ry * 0.78, 0, away - 1.05, away + 1.05)
      ctx.stroke()
      // A peak in the middle of the big ones.
      if (c.rx > 46 * s) {
        fill(mix(p.dusk, p.horizon, 0.3), 0.7)
        ctx.beginPath()
        ctx.ellipse(c.x - ax * c.rx * 0.06, c.y + c.ry * 0.05, c.rx * 0.12, c.ry * 0.16, 0, 0, TAU)
        ctx.fill()
      }
    }

    // Rocks: a dark lump, its sunward edge lit, a long shadow behind it.
    for (let i = 0; i < 70; i++) {
      const v = rand() ** 1.3
      const y = hy + floor * (0.03 + v * 0.82)
      const depth = (y - hy) / floor
      const x = rand() * w
      const r = (1.4 + rand() * 4) * (0.5 + depth * 2.4) * s
      if (built(x, y, r)) continue
      const away = Math.atan2((y - hy) * 3.2, x - sunX)
      stroke(shadow, 0.3, r * 0.9)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(away) * r * (2.5 + rand() * 3), y + Math.sin(away) * r * 0.9)
      ctx.stroke()
      ctx.lineCap = 'butt'
      fill(mix(p.night, p.dusk, 0.22))
      ctx.beginPath()
      ctx.moveTo(x - r, y)
      ctx.lineTo(x - r * 0.5, y - r * (0.7 + rand() * 0.5))
      ctx.lineTo(x + r * 0.4, y - r * (0.5 + rand() * 0.6))
      ctx.lineTo(x + r, y)
      ctx.closePath()
      ctx.fill()
      stroke(rimLight(), night ? 0.35 : 0.7, Math.max(0.7, r * 0.18))
      ctx.beginPath()
      if (x > sunX) {
        ctx.moveTo(x - r, y)
        ctx.lineTo(x - r * 0.5, y - r * 0.8)
      } else {
        ctx.moveTo(x + r, y)
        ctx.lineTo(x + r * 0.4, y - r * 0.7)
      }
      ctx.stroke()
    }
    // Dust: thousands of specks, lighter and darker, coarser toward you.
    for (let i = 0; i < 2600; i++) {
      const v = rand() ** 1.2
      const y = hy + floor * v * 0.92
      const size = 0.6 + ((y - hy) / floor) * 1.6 * rand()
      fill(rand() > 0.5 ? p.ink : dark, 0.035 + rand() * 0.06)
      ctx.fillRect(rand() * w, y, size * 1.6, size * 0.7)
    }

    // ——— The landing pad ———
    {
      const rx = 52 * s
      const ry = 11 * s
      fill(shadow, 0.3)
      ctx.beginPath()
      ctx.ellipse(padX, padY + 2.5 * s, rx * 1.06, ry * 1.1, 0, 0, TAU)
      ctx.fill()
      fill(mix(hull, p.night, 0.45))
      ctx.beginPath()
      ctx.ellipse(padX, padY, rx, ry, 0, 0, TAU)
      ctx.fill()
      stroke(hullLit, 0.7, 1.2 * s)
      ctx.beginPath()
      ctx.ellipse(padX, padY, rx, ry, 0, Math.PI * 0.95, Math.PI * 2.05)
      ctx.stroke()
      stroke(warm, 0.75, 1.1 * s)
      ctx.beginPath()
      ctx.ellipse(padX, padY, rx * 0.62, ry * 0.62, 0, 0, TAU)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(padX - rx * 0.28, padY)
      ctx.lineTo(padX + rx * 0.28, padY)
      ctx.moveTo(padX, padY - ry * 0.3)
      ctx.lineTo(padX, padY + ry * 0.3)
      ctx.stroke()
      // Lights round its edge.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        const lx = padX + Math.cos(a) * rx * 0.94
        const ly = padY + Math.sin(a) * ry * 0.94
        const c = i % 2 ? cool : warm
        ctx.save()
        ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
        glow(lx, ly, 5 * s, c, day ? 0.2 : 0.45)
        ctx.restore()
        fill(mix(c, WHITE, 0.4))
        disc(lx, ly, 1.1 * s)
      }
      layout.pad = { x: padX, y: padY }
      // The road the rover keeps between the pad and the colony: two ruts in the dust.
      const roadEnd = { x: baseX - 162 * big * s, y: baseY + floor * 0.06 }
      stroke(shadow, 0.3, 1.2 * s)
      for (const off of [0, 4.5 * s]) {
        ctx.beginPath()
        ctx.moveTo(padX + rx, padY + 1 * s + off)
        ctx.quadraticCurveTo((padX + rx + roadEnd.x) / 2, (padY + roadEnd.y) / 2 + 3 * s + off, roadEnd.x + 16 * s, roadEnd.y + off)
        ctx.stroke()
      }
      layout.rover = { x: padX + rx + 12 * s, y: padY + 4 * s, dx: roadEnd.x - (padX + rx + 12 * s), dy: roadEnd.y + 3 * s - (padY + 4 * s) }
    }

    // ——— The colony ———
    ;((s: number): void => {
      const ground = baseY
      const leftLit = (x: number, y: number, bw: number, bh: number): void => {
        fill(hull)
        ctx.fillRect(x, y, bw, bh)
        fill(hullLit, 0.85)
        ctx.fillRect(x, y, Math.max(1, 1.4 * s), bh)
        fill(mix(hull, p.ink, 0.3), 0.8)
        ctx.fillRect(x, y, bw, Math.max(1, 1 * s))
        fill(hullDark, 0.55)
        ctx.fillRect(x + bw * 0.7, y + s, bw * 0.3, bh - s)
      }
      const windows = (x: number, y: number, n: number, gap: number, size: number, r: () => number): void => {
        for (let i = 0; i < n; i++) {
          if (r() < 0.25) continue
          fill(r() < 0.3 ? cool : warm, day ? 0.45 : 0.75 + r() * 0.25)
          ctx.fillRect(x + i * gap, y, size, size)
        }
      }
      // Light the colony throws on the ground round it.
      ctx.save()
      ctx.globalCompositeOperation = paper ? 'source-over' : 'lighter'
      glow(baseX, ground + 6 * s, 190 * s, warm, day ? 0.04 : night ? 0.2 : 0.13, 0.2)
      glow(baseX - 96 * s, ground + 5 * s, 80 * s, cool, day ? 0.03 : night ? 0.14 : 0.09, 0.22)
      ctx.restore()

      // The comms tower: a braced mast, a dish turned to the sky, a beacon on top.
      {
        const tx = baseX + 150 * s
        const top = ground - 132 * s
        stroke(hull, 1, 1.5 * s)
        ctx.beginPath()
        ctx.moveTo(tx - 9 * s, ground)
        ctx.lineTo(tx - 1.5 * s, top)
        ctx.moveTo(tx + 9 * s, ground)
        ctx.lineTo(tx + 1.5 * s, top)
        ctx.stroke()
        stroke(hull, 0.85, 0.9 * s)
        ctx.beginPath()
        for (let i = 0; i < 8; i++) {
          const y0 = ground - i * 16 * s
          const y1 = ground - (i + 1) * 16 * s
          const w0 = 9 * s * (1 - (i * 16) / 150)
          const w1 = 9 * s * (1 - ((i + 1) * 16) / 150)
          ctx.moveTo(tx - w0, y0)
          ctx.lineTo(tx + w1, y1)
          ctx.moveTo(tx + w0, y0)
          ctx.lineTo(tx - w1, y1)
        }
        ctx.stroke()
        stroke(hullLit, 0.8, 0.9 * s)
        ctx.beginPath()
        ctx.moveTo(tx - 9 * s, ground)
        ctx.lineTo(tx - 1.5 * s, top)
        ctx.stroke()
        stroke(hull, 1, 1.2 * s)
        ctx.beginPath()
        ctx.moveTo(tx, top)
        ctx.lineTo(tx, top - 16 * s)
        ctx.stroke()
        // The dish.
        ctx.save()
        ctx.translate(tx - 4 * s, ground - 96 * s)
        ctx.rotate(-0.75)
        fill(mix(hull, p.ink, 0.25))
        ctx.beginPath()
        ctx.ellipse(0, 0, 15 * s, 5.5 * s, 0, 0, TAU)
        ctx.fill()
        fill(hullDark)
        ctx.beginPath()
        ctx.ellipse(0, 1.2 * s, 12.5 * s, 3.6 * s, 0, 0, TAU)
        ctx.fill()
        stroke(hullLit, 0.9, 0.9 * s)
        ctx.beginPath()
        ctx.ellipse(0, 0, 15 * s, 5.5 * s, 0, Math.PI * 0.9, Math.PI * 1.9)
        ctx.stroke()
        stroke(hull, 1, 1 * s)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -11 * s)
        ctx.stroke()
        ctx.restore()
        layout.beacons.push({ x: tx, y: top - 17 * s })
      }

      // Fuel tanks: balls on legs, behind the habitats.
      for (const [dx, r] of [
        [196, 11],
        [220, 8]
      ]) {
        const x = baseX + dx * s
        const y = ground - (r + 6) * s
        stroke(hullDark, 1, 1.2 * s)
        ctx.beginPath()
        ctx.moveTo(x - r * 0.6 * s, y)
        ctx.lineTo(x - r * 0.8 * s, ground)
        ctx.moveTo(x + r * 0.6 * s, y)
        ctx.lineTo(x + r * 0.8 * s, ground)
        ctx.stroke()
        const g = ctx.createRadialGradient(x - r * 0.4 * s, y - r * 0.3 * s, r * 0.1 * s, x, y, r * s)
        g.addColorStop(0, css(mix(hullLit, p.ink, 0.3)))
        g.addColorStop(0.5, css(hull))
        g.addColorStop(1, css(hullDark))
        ctx.fillStyle = g
        disc(x, y, r * s)
        stroke(hullDark, 0.6, 0.8 * s)
        ctx.beginPath()
        ctx.ellipse(x, y, r * s, r * 0.3 * s, 0, 0, Math.PI)
        ctx.stroke()
      }

      // Habitats: two long cabins, one on the other, windows along them, on short legs.
      {
        const r = seeded(18)
        const hx = baseX + 70 * s
        for (const [dy, bw, off] of [
          [0, 96, 0],
          [-19, 70, 10]
        ]) {
          const x = hx + off * s
          const y = ground - 22 * s + dy * s
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(x, y, bw * s, 17 * s, 7 * s)
          ctx.clip()
          leftLit(x, y, bw * s, 17 * s)
          ctx.restore()
          windows(x + 9 * s, y + 6 * s, Math.floor((bw - 16) / 8), 8 * s, 3.2 * s, r)
        }
        fill(hullDark)
        for (const lx of [8, 46, 86]) ctx.fillRect(hx + lx * s, ground - 5 * s, 2.4 * s, 5 * s)
        // A hatch, lit, with steps down.
        fill(warm, day ? 0.5 : 0.95)
        ctx.fillRect(hx + 60 * s, ground - 16 * s, 5 * s, 9 * s)
        fill(hullDark)
        ctx.fillRect(hx + 58 * s, ground - 6 * s, 9 * s, 1.5 * s)
      }

      // The domes: a town under glass, the frame's ribs, a highlight where the sun lands.
      const dome = (x: number, r: number, seed: number): void => {
        const rr = seeded(seed)
        // Its plinth.
        leftLit(x - r - 5 * s, ground - 6 * s, r * 2 + 10 * s, 8 * s)
        windows(x - r + 2 * s, ground - 3.6 * s, Math.floor((r * 2) / (7 * s)), 7 * s, 2.2 * s, rr)
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, ground - 6 * s, r, Math.PI, TAU)
        ctx.closePath()
        ctx.clip()
        // The air inside, lit from below.
        const air = ctx.createLinearGradient(0, ground - 6 * s - r, 0, ground - 6 * s)
        air.addColorStop(0, css(mix(p.iris, CYAN, 0.3), 0.16))
        air.addColorStop(1, css(mix(warm, p.iris, 0.4), day ? 0.2 : 0.42))
        ctx.fillStyle = air
        ctx.fillRect(x - r, ground - 6 * s - r, r * 2, r)
        // Towers of the town, tallest in the middle, and trees between them.
        for (let i = 0; i < 9; i++) {
          const t = (i + 0.5) / 9
          const bx = x - r * 0.86 + t * r * 1.72
          const bw = r * (0.09 + rr() * 0.08)
          const bh = r * (0.2 + rr() * 0.5) * Math.sin(t * Math.PI) ** 0.7
          fill(mix(p.night, p.dusk, 0.35))
          ctx.fillRect(bx - bw / 2, ground - 6 * s - bh, bw, bh)
          fill(hullLit, 0.5)
          ctx.fillRect(bx - bw / 2, ground - 6 * s - bh, Math.max(0.8, s), bh)
          for (let wy = ground - 6 * s - bh + 2.5 * s; wy < ground - 9 * s; wy += 3.4 * s) {
            for (let wx = bx - bw / 2 + 1.6 * s; wx < bx + bw / 2 - 1.5 * s; wx += 3 * s) {
              if (rr() < 0.55) {
                fill(rr() < 0.25 ? cool : warm, day ? 0.5 : 0.9)
                ctx.fillRect(wx, wy, 1.5 * s, 1.5 * s)
              }
            }
          }
        }
        for (let i = 0; i < 12; i++) {
          const tx = x - r * 0.9 + rr() * r * 1.8
          fill(mix([70, 190, 120], p.night, 0.35), 0.9)
          disc(tx, ground - 8.5 * s, (2 + rr() * 2.6) * s)
        }
        // Ribs of the frame: meridians, and two rings round.
        stroke(mix(hull, p.ink, 0.3), 0.55, 0.9 * s)
        for (const k of [0.36, 0.72]) {
          ctx.beginPath()
          ctx.ellipse(x, ground - 6 * s, r * k, r, 0, Math.PI, TAU)
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.moveTo(x, ground - 6 * s - r)
        ctx.lineTo(x, ground - 6 * s)
        for (const k of [0.46, 0.8]) {
          const half = Math.sqrt(1 - k * k) * r
          ctx.moveTo(x - half, ground - 6 * s - r * k)
          ctx.quadraticCurveTo(x, ground - 6 * s - r * k + r * 0.07, x + half, ground - 6 * s - r * k)
        }
        ctx.stroke()
        // The glass's own sheen, toward the sun.
        const sheen = ctx.createLinearGradient(x - r, 0, x + r, 0)
        sheen.addColorStop(0, css(mix(p.ink, p.horizon, 0.4), night ? 0.12 : 0.3))
        sheen.addColorStop(0.35, css(p.ink, 0.02))
        sheen.addColorStop(1, css(shadow, 0.3))
        ctx.fillStyle = sheen
        ctx.fillRect(x - r, ground - 6 * s - r, r * 2, r)
        ctx.restore()
        stroke(mix(hull, p.ink, 0.45), 0.95, 1.5 * s)
        ctx.beginPath()
        ctx.arc(x, ground - 6 * s, r, Math.PI, TAU)
        ctx.stroke()
        stroke(WHITE, night ? 0.3 : 0.6, 1.6 * s)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(x, ground - 6 * s, r * 0.9, Math.PI * 1.1, Math.PI * 1.32)
        ctx.stroke()
        ctx.lineCap = 'butt'
        // A mast on its crown.
        stroke(hull, 1, 1 * s)
        ctx.beginPath()
        ctx.moveTo(x, ground - 6 * s - r)
        ctx.lineTo(x, ground - 6 * s - r - 9 * s)
        ctx.stroke()
      }
      // The corridor between the domes, then the domes over its ends.
      {
        const r = seeded(29)
        const x0 = baseX - 100 * s
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x0, ground - 15 * s, 80 * s, 9 * s, 4 * s)
        ctx.clip()
        leftLit(x0, ground - 15 * s, 80 * s, 9 * s)
        ctx.restore()
        windows(x0 + 26 * s, ground - 12.4 * s, 4, 6 * s, 2.6 * s, r)
      }
      dome(baseX - 104 * s, 34 * s, 5)
      dome(baseX, 62 * s, 6)
      layout.beacons.push({ x: baseX, y: ground - 6 * s - 62 * s - 10 * s })

      // The solar field in front: rows of panels tipped toward the sun, each on a post.
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++) {
          const x = baseX - 150 * s + i * 34 * s + row * 16 * s
          const y = ground + (20 + row * 15) * s
          const k = 1 + row * 0.22
          stroke(hullDark, 1, 1.1 * s)
          ctx.beginPath()
          ctx.moveTo(x + 11 * s * k, y)
          ctx.lineTo(x + 11 * s * k, y + 6 * s * k)
          ctx.stroke()
          const panel = ctx.createLinearGradient(x, y - 7 * s * k, x + 24 * s * k, y)
          panel.addColorStop(0, css(mix(mix(p.iris, CYAN, 0.5), p.ink, 0.25)))
          panel.addColorStop(1, css(mix(mix(p.iris, CYAN, 0.3), p.night, 0.6)))
          ctx.fillStyle = panel
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + 5 * s * k, y - 7 * s * k)
          ctx.lineTo(x + 27 * s * k, y - 7 * s * k)
          ctx.lineTo(x + 22 * s * k, y)
          ctx.closePath()
          ctx.fill()
          stroke(p.night, 0.45, 0.6 * s)
          ctx.beginPath()
          for (let g = 1; g < 4; g++) {
            ctx.moveTo(x + g * 5.5 * s * k, y)
            ctx.lineTo(x + 5 * s * k + g * 5.5 * s * k, y - 7 * s * k)
          }
          ctx.moveTo(x + 2.5 * s * k, y - 3.5 * s * k)
          ctx.lineTo(x + 24.5 * s * k, y - 3.5 * s * k)
          ctx.stroke()
          stroke(mix(p.ink, p.horizon, 0.4), 0.7, 0.8 * s)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + 5 * s * k, y - 7 * s * k)
          ctx.lineTo(x + 27 * s * k, y - 7 * s * k)
          ctx.stroke()
        }
      }
    })(s * big)

    // ——— Someone out on the plain, with a flag, looking up at the giant ———
    {
      const x = w * 0.3
      const y = hy + floor * 0.21
      const k = s * (0.9 + ((y - hy) / floor) * 1.2)
      const away = Math.atan2((y - hy) * 3.2, x - sunX)
      stroke(shadow, 0.4, 3 * k)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(away) * 26 * k, y + Math.sin(away) * 7 * k)
      ctx.moveTo(x + 12 * k, y + 1 * k)
      ctx.lineTo(x + 12 * k + Math.cos(away) * 30 * k, y + 1 * k + Math.sin(away) * 8 * k)
      ctx.stroke()
      ctx.lineCap = 'butt'
      // The flag on its pole.
      stroke(mix(hull, p.ink, 0.4), 1, 0.9 * k)
      ctx.beginPath()
      ctx.moveTo(x + 12 * k, y + 1 * k)
      ctx.lineTo(x + 12 * k, y - 19 * k)
      ctx.stroke()
      fill(mix(p.iris, MAGENTA, 0.3))
      ctx.beginPath()
      ctx.moveTo(x + 12 * k, y - 19 * k)
      ctx.lineTo(x + 22 * k, y - 17.5 * k)
      ctx.lineTo(x + 21 * k, y - 12.5 * k)
      ctx.lineTo(x + 12 * k, y - 13 * k)
      ctx.closePath()
      ctx.fill()
      // Legs, pack, body, helmet with the sky in its visor.
      fill(mix(p.ink, p.dusk, 0.3))
      ctx.fillRect(x - 2.4 * k, y - 5 * k, 2 * k, 5 * k)
      ctx.fillRect(x + 0.6 * k, y - 5 * k, 2 * k, 5 * k)
      fill(mix(p.ink, p.dusk, 0.5))
      ctx.fillRect(x + 1.6 * k, y - 11.5 * k, 2.6 * k, 6 * k)
      fill(mix(p.ink, p.dusk, 0.2))
      ctx.beginPath()
      ctx.roundRect(x - 3 * k, y - 11.5 * k, 6 * k, 7 * k, 1.6 * k)
      ctx.fill()
      fill(p.ink)
      disc(x, y - 14 * k, 2.9 * k)
      fill(mix(p.iris, p.horizon, 0.4))
      ctx.beginPath()
      ctx.ellipse(x - 0.8 * k, y - 14 * k, 1.7 * k, 1.9 * k, 0, 0, TAU)
      ctx.fill()
      fill(hullLit, 0.8)
      ctx.fillRect(x - 3 * k, y - 11.5 * k, 1 * k, 7 * k)
    }
  }

  const image = document.createElement('canvas')
  image.width = canvas.width
  image.height = canvas.height
  image.getContext('2d')!.drawImage(canvas, 0, 0)
  kept = { key, image, layout }
  painted.set(canvas, { key, layout })
  return layout
}

export type ShipKind = 'freighter' | 'cruiser' | 'shuttle'
/** How big each kind is drawn, before a lane scales it. */
export const SHIP_SIZE: Record<ShipKind, [number, number]> = { freighter: [132, 34], cruiser: [92, 26], shuttle: [46, 18] }

/** A ship facing right, as a small picture: hull lit from above, windows, running lights, engines. */
export function shipSprite(kind: ShipKind, p: Palette, tint: RGB): string {
  const [sw, sh] = SHIP_SIZE[kind]
  const c = document.createElement('canvas')
  const k = 3
  c.width = sw * k
  c.height = sh * k
  const ctx = c.getContext('2d')!
  ctx.scale(k, k)
  const paper = light(p.night) > light(p.ink)
  const body = mix(mix(p.night, p.ink, paper ? 0.25 : 0.42), tint, 0.22)
  const top = mix(body, p.ink, 0.35)
  const under = mix(body, paper ? p.ink : BLACK, 0.5)
  const shade = (y0: number, y1: number): CanvasGradient => {
    const g = ctx.createLinearGradient(0, y0, 0, y1)
    g.addColorStop(0, css(top))
    g.addColorStop(0.45, css(body))
    g.addColorStop(1, css(under))
    return g
  }
  const engine = (x: number, y: number, r: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4)
    g.addColorStop(0, css([255, 255, 255], 0.95))
    g.addColorStop(0.3, css(mix(tint, CYAN, 0.5), 0.8))
    g.addColorStop(1, css(tint, 0))
    ctx.fillStyle = g
    ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8)
  }
  const lights = (x0: number, x1: number, y: number, gap: number): void => {
    for (let x = x0, i = 0; x < x1; x += gap, i++) {
      ctx.fillStyle = css(i % 4 === 0 ? mix(p.ink, CYAN, 0.5) : mix(p.horizon, p.ink, 0.5), 0.9)
      ctx.fillRect(x, y, 1.1, 1.1)
    }
  }
  if (kind === 'shuttle') {
    engine(5, 10, 3)
    ctx.fillStyle = shade(4, 15)
    ctx.beginPath()
    ctx.moveTo(5, 7)
    ctx.lineTo(13, 5)
    ctx.lineTo(32, 5)
    ctx.quadraticCurveTo(44, 7, 45, 10)
    ctx.quadraticCurveTo(40, 13.5, 30, 14)
    ctx.lineTo(7, 14)
    ctx.closePath()
    ctx.fill()
    // Tail fin, wing, cockpit.
    ctx.fillStyle = css(top)
    ctx.beginPath()
    ctx.moveTo(8, 6)
    ctx.lineTo(10, 1)
    ctx.lineTo(16, 1)
    ctx.lineTo(19, 5.2)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(under)
    ctx.beginPath()
    ctx.moveTo(14, 12)
    ctx.lineTo(9, 17)
    ctx.lineTo(22, 17)
    ctx.lineTo(29, 12.5)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(mix(p.ink, CYAN, 0.6), 0.95)
    ctx.beginPath()
    ctx.moveTo(33, 6.4)
    ctx.quadraticCurveTo(40, 7.4, 42, 9.2)
    ctx.lineTo(34, 9.2)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(tint, 0.9)
    ctx.fillRect(14, 9.6, 14, 1)
    lights(15, 30, 7.4, 3.2)
  } else if (kind === 'cruiser') {
    engine(6, 11, 3.4)
    engine(6, 17, 3)
    ctx.fillStyle = shade(6, 22)
    ctx.beginPath()
    ctx.moveTo(6, 8)
    ctx.lineTo(20, 7)
    ctx.lineTo(58, 8.5)
    ctx.quadraticCurveTo(84, 11, 90, 14)
    ctx.quadraticCurveTo(80, 18.5, 56, 20)
    ctx.lineTo(14, 21)
    ctx.lineTo(6, 19)
    ctx.closePath()
    ctx.fill()
    // The bridge, raised amidships; a keel fin; a stripe in its colours.
    ctx.fillStyle = css(top)
    ctx.beginPath()
    ctx.moveTo(30, 8)
    ctx.lineTo(33, 3)
    ctx.lineTo(48, 3)
    ctx.lineTo(54, 8.4)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(mix(p.ink, CYAN, 0.6), 0.95)
    ctx.fillRect(36, 4.4, 10, 1.6)
    ctx.fillStyle = css(under)
    ctx.beginPath()
    ctx.moveTo(22, 20.6)
    ctx.lineTo(28, 25)
    ctx.lineTo(44, 25)
    ctx.lineTo(50, 20)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(tint, 0.9)
    ctx.fillRect(16, 14, 56, 1.2)
    lights(18, 76, 11, 3.4)
    lights(20, 60, 17, 4.2)
  } else {
    engine(7, 12, 4.2)
    engine(7, 22, 4.2)
    // A long spine, the drive block aft, the bridge forward, containers slung between.
    ctx.fillStyle = shade(13, 21)
    ctx.fillRect(14, 14.5, 104, 5)
    ctx.fillStyle = shade(6, 28)
    ctx.beginPath()
    ctx.roundRect(6, 6, 22, 22, 3)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(106, 9)
    ctx.lineTo(122, 10)
    ctx.quadraticCurveTo(130, 14, 131, 17)
    ctx.quadraticCurveTo(128, 23, 120, 25)
    ctx.lineTo(106, 25)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(mix(p.ink, CYAN, 0.6), 0.95)
    ctx.fillRect(116, 12.4, 9, 1.8)
    const loads = [tint, mix(p.iris, p.ink, 0.3), mix(p.horizon, p.night, 0.3), mix(p.dusk, p.ink, 0.2), tint, mix(p.iris, p.night, 0.3)]
    loads.forEach((load, i) => {
      for (const y of [4.5, 20.5]) {
        const x = 32 + i * 12.2
        const g = ctx.createLinearGradient(0, y, 0, y + 9)
        g.addColorStop(0, css(mix(load, p.ink, 0.25)))
        g.addColorStop(1, css(mix(load, paper ? p.ink : BLACK, 0.45)))
        ctx.fillStyle = g
        ctx.fillRect(x, y, 10.6, 9)
        ctx.fillStyle = css(under, 0.6)
        ctx.fillRect(x + 3.4, y, 0.7, 9)
        ctx.fillRect(x + 6.9, y, 0.7, 9)
      }
    })
    lights(16, 104, 16.4, 5)
    ctx.fillStyle = css([255, 70, 90])
    ctx.fillRect(8, 5, 1.6, 1.6)
    ctx.fillStyle = css([90, 255, 160])
    ctx.fillRect(8, 27.4, 1.6, 1.6)
  }
  return c.toDataURL()
}

export interface SpaceSprites {
  /** Each kind of ship in three liveries, in the theme's own neon. */
  ships: Record<ShipKind, string[]>
  rover: string
}
let keptSprites: { key: string; sprites: SpaceSprites } | null = null

/** The pictures of everything that moves, made once per set of colours. */
export function spaceSprites(p: Palette): SpaceSprites {
  const key = Object.values(p).flat().join(',')
  if (keptSprites?.key === key) return keptSprites.sprites
  const tints: RGB[] = [mix(p.iris, MAGENTA, 0.45), mix(p.ink, CYAN, 0.65), mix(p.horizon, MAGENTA, 0.2)]
  const kinds: ShipKind[] = ['freighter', 'cruiser', 'shuttle']
  const ships = Object.fromEntries(kinds.map((kind) => [kind, tints.map((tint) => shipSprite(kind, p, tint))])) as Record<ShipKind, string[]>
  keptSprites = { key, sprites: { ships, rover: roverSprite(p) } }
  return keptSprites.sprites
}

/** The rover, facing right: a cabin on six wheels, a dish, a headlamp. */
export function roverSprite(p: Palette): string {
  const c = document.createElement('canvas')
  const k = 3
  c.width = 30 * k
  c.height = 16 * k
  const ctx = c.getContext('2d')!
  ctx.scale(k, k)
  const paper = light(p.night) > light(p.ink)
  const body = mix(p.night, p.ink, paper ? 0.3 : 0.5)
  ctx.fillStyle = css(mix(body, paper ? p.ink : BLACK, 0.5))
  for (const x of [5, 13, 21]) {
    ctx.beginPath()
    ctx.arc(x, 13, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = css(body)
  ctx.beginPath()
  ctx.roundRect(2, 5.5, 22, 6, 2)
  ctx.fill()
  ctx.fillStyle = css(mix(body, p.ink, 0.4))
  ctx.fillRect(2, 5.5, 22, 1)
  ctx.fillStyle = css(mix(p.ink, CYAN, 0.6))
  ctx.beginPath()
  ctx.roundRect(15, 6.6, 7, 3, 1)
  ctx.fill()
  ctx.strokeStyle = css(body)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(7, 5.5)
  ctx.lineTo(7, 1.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(7, 1.8, 3, 1.1, -0.4, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = css([255, 244, 214])
  ctx.fillRect(24, 8, 1.4, 1.6)
  return c.toDataURL()
}
