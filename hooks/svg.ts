// The desktop's drawings: the chip icons, as SVG markup.
// Colors follow the system appearance through prefers-color-scheme.

import type { Icon } from './model'

const PALETTE = `
  :root { --icon:#9d9da3; --track:rgba(255,255,255,.10); --ok:#5b8def; --warn:#f0a43c; --bad:#ef5b55; }
  @media (prefers-color-scheme: light) {
    :root { --icon:#7a7a80; --track:rgba(0,0,0,.08); --ok:#3b73e0; --warn:#c77a12; --bad:#d6403a; }
  }`

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

/** A chip's icon at `size` CSS pixels. */
export const iconSvg = (icon: Icon, size: number, ring?: number | null): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
  `<style>${PALETTE}</style>` +
  `<g fill="none" stroke="var(--icon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `${glyph(icon, ring)}</g></svg>`
