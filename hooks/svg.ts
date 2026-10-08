// The desktop's drawings: chip icons and the hover cards, as SVG markup.
// Colors follow the system appearance through prefers-color-scheme.

import type { Card, Icon, Tone } from './model'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', sans-serif`

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

/** A chip's icon at `size` CSS pixels. */
export const iconSvg = (icon: Icon, size: number, ring?: number | null): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
  `<style>${PALETTE}</style>` +
  `<g fill="none" stroke="var(--icon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `${glyph(icon, ring)}</g></svg>`

// The card's geometry, in CSS pixels.
const W = 296
const M = 12 // room for the shadow
const PAD = 16
const ROW = 30
const METER = 62

export type CardDrawing = { source: string; width: number; height: number }

export const cardSvg = (card: Card): CardDrawing => {
  const x0 = M + PAD
  const x1 = M + W - PAD
  const parts: string[] = []
  let y = M + PAD

  // Title: icon, name, and a figure at the right.
  parts.push(
    `<g transform="translate(${x0} ${y - 1}) scale(0.75)" fill="none" stroke="var(--fg)" stroke-width="2"` +
      ` stroke-linecap="round" stroke-linejoin="round">${glyph(card.icon, null)}</g>`,
  )
  parts.push(`<text class="title" x="${x0 + 26}" y="${y + 14}">${esc(card.title)}</text>`)
  if (card.right) {
    const cls = card.isRightQuiet ? 'note r' : 'title r'
    parts.push(`<text class="${cls}" x="${x1}" y="${y + 14}">${esc(card.right)}</text>`)
  }
  y += 30
  parts.push(`<line x1="${x0}" x2="${x1}" y1="${y + 0.5}" y2="${y + 0.5}" stroke="var(--line)"/>`)
  y += 6

  for (const row of card.rows) {
    const base = y + 20
    parts.push(`<text class="label" x="${x0}" y="${base}">${esc(row.label)}</text>`)
    parts.push(
      `<text class="value r" x="${x1}" y="${base}" style="fill:${TONE[row.tone ?? 'normal']}">${esc(row.value)}</text>`,
    )
    y += ROW
  }

  if (card.rows.length === 0 && card.meters.length === 0 && card.empty) {
    parts.push(`<text class="label" x="${x0}" y="${y + 20}">${esc(card.empty)}</text>`)
    y += ROW
  }

  for (const m of card.meters) {
    const base = y + 20
    parts.push(`<text class="label" x="${x0}" y="${base}">${esc(m.label)}</text>`)
    parts.push(`<text class="value r" x="${x1}" y="${base}" style="fill:${TONE[m.tone]}">${esc(m.value)}</text>`)
    const by = y + 30
    const bw = x1 - x0
    parts.push(`<rect x="${x0}" y="${by}" width="${bw}" height="6" rx="3" fill="var(--track)"/>`)
    if (m.pct !== null && m.pct > 0) {
      const fw = Math.max(6, Math.min(bw, (m.pct / 100) * bw))
      parts.push(`<rect x="${x0}" y="${by}" width="${fw.toFixed(1)}" height="6" rx="3" fill="${TONE[m.tone]}"/>`)
    }
    if (m.note) parts.push(`<text class="note" x="${x0}" y="${y + 54}">${esc(m.note)}</text>`)
    y += METER
  }

  if (card.foot.length > 0) {
    y += 4
    parts.push(`<line x1="${x0}" x2="${x1}" y1="${y + 0.5}" y2="${y + 0.5}" stroke="var(--line)"/>`)
    y += 2
    for (const line of card.foot) {
      parts.push(`<text class="note" x="${x0}" y="${y + 18}">${esc(line)}</text>`)
      y += 18
    }
    y += 6
  }

  y += PAD - 4
  const h = y - M
  const width = W + 2 * M
  const height = h + 2 * M

  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>${PALETTE}
      text { font-family: ${FONT}; font-variant-numeric: tabular-nums; }
      .title { font-size: 14px; font-weight: 600; fill: var(--fg); }
      .label { font-size: 13px; fill: var(--mute); }
      .value { font-size: 13px; fill: var(--fg); }
      .note { font-size: 11.5px; fill: var(--mute); }
      .r { text-anchor: end; }
    </style>` +
    `<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="130%">` +
    `<feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity=".28"/></filter></defs>` +
    `<rect x="${M + 0.5}" y="${M + 0.5}" width="${W - 1}" height="${h - 1}" rx="12" fill="var(--bg)"` +
    ` stroke="var(--edge)" filter="url(#sh)"/>` +
    parts.join('') +
    `</svg>`

  return { source, width, height }
}
