// The values cc-usage-hud keeps in $.state (they survive a hot reload).

/** Session counters, summed from every turn.step the session made. */
export type HudStats = {
  /** Main-thread turns (one per prompt). */
  turns: number
  /** Main-thread model requests. */
  steps: number
  /** Subagent model requests. */
  subSteps: number
  /** Main thread: summed request time (send → stop), ms. */
  modelMs: number
  /** Main thread: summed tool-call time, ms (user-wait tools excluded). */
  toolMs: number
  /** Main thread: summed and counted time to first token, ms. */
  ttftMs: number
  ttftN: number
  /** Main thread: output tokens and generation time (first token → stop) for TPS. */
  genOut: number
  genMs: number
  /** Subagents: the same, for their TPS. */
  subGenOut: number
  subGenMs: number
  /** The last main-thread response's TPS. */
  lastTps: number | null
  /** Token counts over every response, subagents included (as /cost counts them). */
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

export type HudLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** What $.session.usage() last said, plus the cached rate-limit reading. */
export type HudSnap = {
  costUsd: number | null
  limits: HudLimit[]
  /** When `limits` was read, ms since epoch. */
  limitsAt: number | null
  /** True while `limits` is a reading cached from an earlier session. */
  limitsStale: boolean
  ctxTokens: number | null
  ctxWindow: number | null
  ctxPercent: number | null
}

/** Cost totals over every session's ledger, this one included (USD). */
export type HudTotals = {
  today: number
  week: number
  month: number
  /** The first day the ledger holds (YYYY-MM-DD). */
  since: string | null
}

/** This session's ledger, mirrored here so a hot reload keeps it. */
export type HudOwn = {
  sessionId: string
  lastTotal: number
  days: Record<string, number>
}

export type HudCard = 'stats' | 'tokens' | 'limits' | 'cost'

declare module 'claude-code' {
  interface PluginState {
    'cc-usage-hud': {
      stats: HudStats
      snap: HudSnap
      totals: HudTotals
      own: HudOwn | null
      pinned: HudCard | null
      tick: number
    }
  }
}
