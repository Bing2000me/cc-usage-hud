// What the HUD shows, worked out once from state, drawn by either surface.

import type { HudCard, HudSnap, HudStats, HudTotals } from '../types'
import * as F from './format'

export type Tone = 'normal' | 'ok' | 'warn' | 'bad' | 'dim'
export type Icon = 'gauge' | 'database' | 'ring' | 'timer' | 'coin'

export type Row = { label: string; value: string; tone?: Tone }
export type Meter = { label: string; pct: number | null; value: string; note: string; tone: Tone }

export type Card = {
  id: HudCard
  icon: Icon
  title: string
  right: string
  /** Draws `right` as a quiet note rather than a figure. */
  isRightQuiet?: boolean
  rows: Row[]
  meters: Meter[]
  empty?: string
  foot: string[]
}

/** A chip's label at three widths: full, shorter, shortest. */
export type Chip = { id: HudCard; icon: Icon; labels: [string, string, string]; ring?: number | null }

export type View = { chips: Chip[]; cards: Card[] }

export const ORDER: HudCard[] = ['stats', 'tokens', 'limits', 'cost']

const tpsText = (v: number | null) => (v === null ? '—' : `${Math.round(v)} tok/s`)

/** The widest of a chip set's three label tiers whose total fits in `room`. */
export const pickTier = (chips: Chip[], room: number, widthOf: (label: string) => number): 0 | 1 | 2 => {
  for (const tier of [0, 1] as const) {
    if (chips.reduce((w, c) => w + widthOf(c.labels[tier]), 0) <= room) return tier
  }
  return 2
}

const toneOf = (pct: number): Tone => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok')

export const buildView = (
  s: HudStats,
  snap: HudSnap,
  totals: HudTotals,
  now: number,
  tzMin: number,
): View => {
  const mainTps = F.tps(s.genOut, s.genMs)
  const subTps = F.tps(s.subGenOut, s.subGenMs)
  const hit = F.hitRate(s)
  const hitText = hit === null ? '—' : F.fmtPct(hit)
  const totalTok = s.input + s.cacheWrite + s.cacheRead + s.output

  const isOld = (resetsAt: string | undefined) => snap.limitsStale && F.isReset(resetsAt, now)
  const five = snap.limits.find(l => l.kind === 'five_hour')
  const seven = snap.limits.find(l => l.kind === 'seven_day')
  const pctOf = (l: typeof five) => (!l || isOld(l.resetsAt) ? null : l.percentUsed)
  const pctText = (p: number | null) => (p === null ? '—' : F.fmtPct(p))
  const fivePct = pctOf(five)
  const sevenPct = pctOf(seven)

  const tpsShort = mainTps === null ? '—' : `${Math.round(mainTps)} tok/s`
  const hasLimits = snap.limits.length > 0
  const limitsText = `5h ${pctText(fivePct)} · 7d ${pctText(sevenPct)}`
  const costText = `${F.fmtUsd(snap.costUsd ?? 0)} · 今日 ${F.fmtUsd(totals.today)}`

  const chips: Chip[] = [
    {
      id: 'stats',
      icon: 'gauge',
      labels: [`${s.turns} 轮 ${s.steps} 步 · ${tpsShort}`, `${s.steps} 步 · ${tpsShort}`, tpsShort],
    },
    {
      id: 'tokens',
      icon: 'database',
      labels: [`${F.fmtTok(totalTok)} tok · 缓存命中 ${hitText}`, `${F.fmtTok(totalTok)} · 命中 ${hitText}`, `命中 ${hitText}`],
    },
    {
      id: 'limits',
      icon: 'ring',
      ring: fivePct,
      labels: hasLimits ? [limitsText, limitsText, `5h ${pctText(fivePct)}`] : ['限额 —', '限额 —', '—'],
    },
    {
      id: 'cost',
      icon: 'coin',
      labels: [costText, costText, F.fmtUsd(snap.costUsd ?? 0)],
    },
  ]

  const cards: Card[] = [
    {
      id: 'stats',
      icon: 'gauge',
      title: '会话统计',
      right: `${s.turns} 轮 · ${s.steps} 步`,
      isRightQuiet: true,
      rows: [
        { label: '模型用时', value: F.fmtDur(s.modelMs) },
        { label: '工具调用用时', value: F.fmtDur(s.toolMs) },
        { label: '首 token 平均（TTFT）', value: s.ttftN > 0 ? F.fmtDur(s.ttftMs / s.ttftN) : '—' },
        { label: '输出速度（TPS）', value: tpsText(mainTps) },
        ...(s.subSteps > 0 ? [{ label: '子代理', value: `${s.subSteps} 步 · ${tpsText(subTps)}` }] : []),
      ],
      meters: [],
      foot: ['主线程计时 · 输出 token 含 thinking'],
    },
    {
      id: 'tokens',
      icon: 'database',
      title: 'Token 用量',
      right: `${F.fmtTok(totalTok)} tok`,
      isRightQuiet: true,
      rows: [
        { label: '未缓存输入', value: F.fmtInt(s.input) },
        { label: '缓存写入', value: F.fmtInt(s.cacheWrite) },
        { label: '缓存读取', value: F.fmtInt(s.cacheRead) },
        { label: '输出', value: F.fmtInt(s.output) },
      ],
      meters: [{ label: '缓存命中', pct: hit, value: hitText, note: '', tone: 'ok' }],
      foot: ['含子代理 · 命中率 = 缓存读取 ÷ 全部输入'],
    },
    {
      id: 'limits',
      icon: 'timer',
      title: '用量限额',
      right: snap.limitsStale && snap.limitsAt !== null ? `上次读数 · ${F.fmtAgo(now - snap.limitsAt)}` : '',
      isRightQuiet: true,
      rows: [],
      meters: snap.limits.map(l => {
        const old = isOld(l.resetsAt)
        return {
          label: F.limitLabel(l.kind),
          pct: old ? null : l.percentUsed,
          value: old ? '—' : `${l.percentUsed}%`,
          note: F.fmtReset(l.resetsAt, now, tzMin),
          tone: old ? 'dim' : toneOf(l.percentUsed),
        }
      }),
      empty: '暂无读数 · 本会话首次响应后显示',
      foot: ['账号级窗口，所有会话共用'],
    },
    {
      id: 'cost',
      icon: 'coin',
      title: '费用',
      right: `按 API 标价${totals.since ? ` · 自 ${totals.since.slice(5).replace('-', '/')} 起` : ''}`,
      isRightQuiet: true,
      rows: [
        { label: '本会话', value: F.fmtUsd(snap.costUsd ?? 0) },
        { label: '今日', value: F.fmtUsd(totals.today) },
        { label: '本周', value: F.fmtUsd(totals.week) },
        { label: '本月', value: F.fmtUsd(totals.month) },
      ],
      meters: [],
      foot: ['与 /cost 同口径，订阅为等价费用', ...(totals.since ? [`累计自 ${totals.since.slice(5).replace('-', '/')} 起`] : [])],
    },
  ]

  return { chips, cards }
}
