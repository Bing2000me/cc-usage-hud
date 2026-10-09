// The desktop's drawings: chip icons, the page layer and the panels, as SVG markup.
// Colors follow the system appearance through prefers-color-scheme.

import type { Card, Icon, Tone } from './model'

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

/** Empty room `height` CSS pixels tall: what nudges a row by less than a cell. */
export const spacerSvg = (height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${height}" viewBox="0 0 1 ${height}"></svg>`

/** A chip's icon at `size` CSS pixels. */
export const iconSvg = (icon: Icon, size: number, ring?: number | null): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
  `<style>${PALETTE}</style>` +
  `<g fill="none" stroke="var(--icon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `${glyph(icon, ring)}</g></svg>`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', sans-serif`

export type Drawing = { source: string; width: number; height: number }

// The panel a chip's press opens, in CSS pixels: its cards side by side
// (one, as the desktop opens them), set the way the desktop's own usage
// popover is: gray headings, dark labels, gray figures, blue meters.
const PCOL = 230
const PM = 6 // room for the shadow
const PPAD = 16
const PGAP = 32
const PROW = 25
const PMETER = 40

export const panelSvg = (cards: Card[], colW = PCOL): Drawing => {
  const n = Math.max(1, cards.length)
  const panelW = 2 * PPAD + n * colW + (n - 1) * PGAP
  const top = PM + PPAD
  const parts: string[] = []
  let bottom = top

  cards.forEach((card, i) => {
    const x0 = PM + PPAD + i * (colW + PGAP)
    const x1 = x0 + colW
    let y = top
    parts.push(`<text class="head" x="${x0}" y="${y + 12}">${esc(card.title)}</text>`)
    if (card.right) parts.push(`<text class="head r" x="${x1}" y="${y + 12}">${esc(card.right)}</text>`)
    y += 24
    for (const m of card.meters) {
      parts.push(`<text class="label" x="${x0}" y="${y + 15}">${esc(m.label)}</text>`)
      parts.push(`<text class="value r" x="${x1}" y="${y + 15}">${esc(m.value)}</text>`)
      parts.push(`<rect x="${x0}" y="${y + 24}" width="${colW}" height="6" rx="3" fill="var(--track)"/>`)
      if (m.pct !== null && m.pct > 0) {
        const fw = Math.max(6, Math.min(colW, (m.pct / 100) * colW))
        parts.push(`<rect x="${x0}" y="${y + 24}" width="${fw.toFixed(1)}" height="6" rx="3" fill="${TONE[m.tone]}"/>`)
      }
      y += PMETER
    }
    for (const row of card.rows) {
      parts.push(`<text class="label" x="${x0}" y="${y + 16}">${esc(row.label)}</text>`)
      parts.push(`<text class="value r" x="${x1}" y="${y + 16}">${esc(row.value)}</text>`)
      y += PROW
    }
    bottom = Math.max(bottom, y)
  })

  const h = bottom - PM + PPAD - 8
  const dividers = cards
    .slice(1)
    .map((_, i) => {
      const x = PM + PPAD + (i + 1) * (colW + PGAP) - PGAP / 2
      return `<line x1="${x + 0.5}" x2="${x + 0.5}" y1="${top}" y2="${PM + h - PPAD + 8}" stroke="var(--line)"/>`
    })
    .join('')
  const width = panelW + 2 * PM
  const height = h + 2 * PM

  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>${PALETTE}
      text { font-family: ${FONT}; font-variant-numeric: tabular-nums; }
      .head { font-size: 12.5px; fill: var(--mute); }
      .label { font-size: 13px; fill: var(--fg); }
      .value { font-size: 13px; fill: var(--mute); }
      .r { text-anchor: end; }
    </style>` +
    `<defs><filter id="sh" x="-5%" y="-10%" width="110%" height="130%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".12"/></filter></defs>` +
    `<rect x="${PM + 0.5}" y="${PM + 0.5}" width="${panelW - 1}" height="${h - 1}" rx="12" fill="var(--bg)"` +
    ` stroke="var(--edge)" filter="url(#sh)"/>` +
    dividers +
    parts.join('') +
    `</svg>`

  return { source, width, height }
}
