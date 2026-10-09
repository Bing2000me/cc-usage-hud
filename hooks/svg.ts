// The desktop's drawings: chip icons, detail-line meters and the page layer, as SVG markup.
// Colors follow the system appearance through prefers-color-scheme.

import type { Icon, Tone } from './model'

const PALETTE = `
  :root { --bg:#2a2a2d; --edge:rgba(255,255,255,.10); --fg:#ededf0; --mute:#9d9da3; --line:rgba(255,255,255,.08);
          --track:rgba(255,255,255,.10); --ok:#5b8def; --warn:#f0a43c; --bad:#ef5b55; --icon:#9d9da3; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#ffffff; --edge:rgba(0,0,0,.10); --fg:#1d1d1f; --mute:#6e6e73; --line:rgba(0,0,0,.08);
            --track:rgba(0,0,0,.08); --ok:#3b73e0; --warn:#c77a12; --bad:#d6403a; --icon:#7a7a80; }
  }`

const TONE: Record<Tone, string> = {
  normal: 'var(--fg)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  dim: 'var(--mute)',
}

/** One 24-unit icon's strokes (lucide-style geometry). */
const glyph = (icon: Icon, ring: number | null | undefined): string => {
  switch (icon) {
    case 'gauge':
      return `<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>`
    case 'database':
      return `<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>`
    case 'timer':
      return `<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>`
    case 'coin':
      return `<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>`
    case 'ring': {
      const r = 9
      const c = 2 * Math.PI * r
      const p = Math.max(0, Math.min(100, ring ?? 0))
      const tone = p >= 90 ? 'var(--bad)' : p >= 70 ? 'var(--warn)' : 'var(--ok)'
      return (
        `<circle cx="12" cy="12" r="${r}" stroke="var(--track)" stroke-width="3.2"/>` +
        (p > 0
          ? `<circle cx="12" cy="12" r="${r}" stroke="${tone}" stroke-width="3.2" stroke-linecap="round"` +
            ` stroke-dasharray="${((p / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 12 12)"/>`
          : '')
      )
    }
  }
}

/**
 * The desktop page's own background, in both appearances (sampled from the app,
 * in sRGB): laid under the band so its gray tray disappears and the chips and
 * cards sit on the page itself.
 */
export const PAGE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1600">` +
  `<style>rect{fill:#fcfcfb}@media (prefers-color-scheme: dark){rect{fill:#151515}}</style>` +
  `<rect width="4000" height="1600"/></svg>`

/** A chip's icon at `size` CSS pixels. */
export const iconSvg = (icon: Icon, size: number, ring?: number | null): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
  `<style>${PALETTE}</style>` +
  `<g fill="none" stroke="var(--icon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `${glyph(icon, ring)}</g></svg>`

/** A short meter for a detail line: `pct` of `width` CSS pixels filled, in its tone. */
export const meterSvg = (pct: number | null, tone: Tone, width: number): string => {
  const fill = pct === null || pct <= 0 ? 0 : Math.max(3, Math.min(width, (pct / 100) * width))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6">` +
    `<style>${PALETTE}</style>` +
    `<rect width="${width}" height="6" rx="3" fill="var(--track)"/>` +
    (fill > 0 ? `<rect width="${fill.toFixed(1)}" height="6" rx="3" fill="${TONE[tone]}"/>` : '') +
    `</svg>`
  )
}
