// Pure formatting and date helpers; no `$`, so tests call them directly.

const isWide = (c: number) =>
  (c >= 0x1100 && c <= 0x115f) ||
  (c >= 0x2e80 && c <= 0xa4cf) ||
  (c >= 0xac00 && c <= 0xd7a3) ||
  (c >= 0xf900 && c <= 0xfaff) ||
  (c >= 0xfe30 && c <= 0xfe4f) ||
  (c >= 0xff00 && c <= 0xff60) ||
  (c >= 0xffe0 && c <= 0xffe6)

/** Terminal cells a string takes: CJK and fullwidth forms count two. */
export const cellWidth = (s: string): number => {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
}

/** 3678039 → "3,678,039". */
export const fmtInt = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const trim0 = (s: string) => s.replace(/\.0$/, '')

/** 3678039 → "3.7M", 164000 → "164K", 950 → "950". */
export const fmtTok = (n: number): string => {
  if (n >= 1e9) return `${trim0((n / 1e9).toFixed(1))}B`
  if (n >= 1e6) return `${trim0((n / 1e6).toFixed(1))}M`
  if (n >= 1e5) return `${Math.round(n / 1e3)}K`
  if (n >= 1e3) return `${trim0((n / 1e3).toFixed(1))}K`
  return String(Math.round(n))
}

/** 671000 → "11分11秒", 7300 → "7.3秒", 3780000 → "1小时3分". */
export const fmtDur = (ms: number): string => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}秒`
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}小时${m}分` : `${m}分${s % 60}秒`
}

export const fmtUsd = (u: number | null | undefined): string => {
  if (u === null || u === undefined) return '—'
  if (u > 0 && u < 0.005) return '<$0.01'
  if (u >= 1000) return `$${fmtInt(u)}`
  if (u >= 100) return `$${u.toFixed(0)}`
  return `$${u.toFixed(2)}`
}

export const fmtPct = (p: number): string => `${Math.round(p)}%`

/** Hit rate: what the cache served over every input token. */
export const hitRate = (s: { input: number; cacheWrite: number; cacheRead: number }): number | null => {
  const all = s.input + s.cacheWrite + s.cacheRead
  return all > 0 ? (s.cacheRead / all) * 100 : null
}

export const tps = (out: number, ms: number): number | null => (ms > 0 && out > 0 ? out / (ms / 1000) : null)

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day of `ms` (YYYY-MM-DD), `tzMin` minutes east of UTC. */
export const dayKey = (ms: number, tzMin: number): string =>
  new Date(ms + tzMin * 60_000).toISOString().slice(0, 10)

/** "+0800" → 480. */
export const parseTz = (s: string): number | null => {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(s.trim())
  if (!m) return null
  const v = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -v : v
}

export type Ranges = { today: string; weekStart: string; monthStart: string; earliestMs: number }

/** Today, this week (from Monday) and this month, local. */
export const ranges = (now: number, tzMin: number): Ranges => {
  const today = dayKey(now, tzMin)
  const midnight = Date.parse(`${today}T00:00:00Z`)
  const dow = (new Date(midnight).getUTCDay() + 6) % 7
  const weekStart = new Date(midnight - dow * 86_400_000).toISOString().slice(0, 10)
  const monthStart = `${today.slice(0, 8)}01`
  const earliest = weekStart < monthStart ? weekStart : monthStart
  return { today, weekStart, monthStart, earliestMs: Date.parse(`${earliest}T00:00:00Z`) - tzMin * 60_000 }
}

export const sumDays = (days: Record<string, number>, r: Ranges) => {
  let today = 0
  let week = 0
  let month = 0
  for (const [k, v] of Object.entries(days)) {
    if (k > r.today || typeof v !== 'number') continue
    if (k === r.today) today += v
    if (k >= r.weekStart) week += v
    if (k >= r.monthStart) month += v
  }
  return { today, week, month }
}

const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5 小时',
  seven_day: '7 天',
  seven_day_opus: '7 天 · Opus',
  seven_day_sonnet: '7 天 · Sonnet',
  spend_limit: '消费上限',
}
export const limitLabel = (kind: string) => LIMIT_LABEL[kind] ?? kind

const LIMIT_SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
export const limitShort = (kind: string) => LIMIT_SHORT[kind]

const fmtLeft = (ms: number) => {
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m}分`
  if (m < 1440) return m % 60 === 0 ? `${m / 60}小时` : `${Math.floor(m / 60)}小时${m % 60}分`
  const h = Math.floor((m % 1440) / 60)
  return h === 0 ? `${Math.floor(m / 1440)}天` : `${Math.floor(m / 1440)}天${h}小时`
}

/** "2小时13分后重置 · 04:50", or the date when it is not today. */
export const fmtReset = (resetsAt: string | undefined, now: number, tzMin: number): string => {
  const t = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(t)) return ''
  if (t <= now) return '已重置'
  const d = new Date(t + tzMin * 60_000)
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  const when = dayKey(t, tzMin) === dayKey(now, tzMin) ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`
  return `${fmtLeft(t - now)}后重置 · ${when}`
}

export const isReset = (resetsAt: string | undefined, now: number) => {
  const t = resetsAt ? Date.parse(resetsAt) : NaN
  return !Number.isNaN(t) && t <= now
}

export const fmtAgo = (ms: number) => (ms < 60_000 ? '刚刚' : `${fmtLeft(ms)}前`)

/** A bar of `width` cells, `pct` of them full. */
export const bar = (pct: number, width: number): string => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}

/** Theme color for how close a limit is. */
export const limitColor = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')
