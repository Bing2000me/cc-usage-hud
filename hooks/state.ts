import type { HudSnap, HudStats, HudTotals } from '../types'

export const EMPTY_STATS: HudStats = {
  turns: 0,
  steps: 0,
  subSteps: 0,
  modelMs: 0,
  toolMs: 0,
  ttftMs: 0,
  ttftN: 0,
  genOut: 0,
  genMs: 0,
  subGenOut: 0,
  subGenMs: 0,
  lastTps: null,
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
}

export const EMPTY_SNAP: HudSnap = {
  costUsd: null,
  limits: [],
  limitsAt: null,
  limitsStale: false,
  ctxTokens: null,
  ctxWindow: null,
  ctxPercent: null,
}

export const EMPTY_TOTALS: HudTotals = { today: 0, week: 0, month: 0, since: null }
