// The cross-session cost ledger: each session owns one small file,
// ~/.claude/cc-usage-hud/ledger/<sessionId>.json, holding the USD it added
// per local day. Only growth is recorded, at the price the engine charged
// then, so a later price change never rewrites a past day.
//
// Pure bookkeeping: the hooks do the reading and writing it asks for.

import type { FsEntry } from 'claude-code'

import type { HudLimit, HudOwn, HudTotals } from '../types'
import { dayKey, ranges, sumDays } from './format'

export type Write = { path: string; text: string }
export type LedgerFile = HudOwn & { v: 1; updatedAt: number }
export type LimitsCache = { at: number; limits: HudLimit[] }

const WRITE_EVERY_MS = 5_000

export const parseJson = <T>(text: string | null | undefined): T | null => {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export class Ledger {
  base: string | null = null
  tzMin = -new Date().getTimezoneOffset()
  own: HudOwn | null = null
  since: string | null = null
  private dirty = false
  private lastWrite = 0
  private others = { today: 0, week: 0, month: 0 }
  // A session left by /clear, counted here until the next settle reads its file.
  private retired = { today: 0, week: 0, month: 0 }
  private files = new Map<string, { mtimeMs: number; days: Record<string, number> }>()

  dir = () => `${this.base}/ledger`
  ownPath = (id: string) => `${this.dir()}/${id}.json`
  metaPath = () => `${this.base}/meta.json`
  limitsPath = () => `${this.base}/ratelimits.json`

  /**
   * Picks this session's ledger: the one a hot reload kept, else its file,
   * else a fresh one whose baseline is the cost the session started with (a
   * resumed session's restored cost was counted when it was spent).
   */
  start(sessionId: string, held: HudOwn | null, file: LedgerFile | null, startCost: number | null) {
    if (held && held.sessionId === sessionId) this.own = { ...held, days: { ...held.days } }
    else if (file) this.own = { sessionId, lastTotal: file.lastTotal, days: { ...(file.days ?? {}) } }
    else this.own = { sessionId, lastTotal: startCost ?? 0, days: {} }
  }

  /** Folds the session's cost total in; returns the files to write now. */
  applyCost(total: number, now: number, sessionId: string): Write[] {
    if (!this.own) return []
    const writes: Write[] = []
    if (sessionId !== this.own.sessionId) {
      // /clear or a fork: the old file is done, the baseline carries on.
      const last = this.take(now, true)
      if (last) writes.push(last)
      const gone = sumDays(this.own.days, ranges(now, this.tzMin))
      this.retired = {
        today: this.retired.today + gone.today,
        week: this.retired.week + gone.week,
        month: this.retired.month + gone.month,
      }
      this.own = { sessionId, lastTotal: this.own.lastTotal, days: {} }
    }
    let delta = total - this.own.lastTotal
    if (delta < -1e-9) delta = total // the engine's total started over
    this.own.lastTotal = total
    if (delta > 1e-9) {
      const k = dayKey(now, this.tzMin)
      this.own.days[k] = (this.own.days[k] ?? 0) + delta
      this.dirty = true
    }
    const w = this.take(now, false)
    if (w) writes.push(w)
    return writes
  }

  /** This session's file, when it changed and is due (or `force`). */
  take(now: number, force: boolean): Write | null {
    if (!this.base || !this.own || !this.dirty) return null
    if (!force && now - this.lastWrite < WRITE_EVERY_MS) return null
    this.dirty = false
    this.lastWrite = now
    const file: LedgerFile = { v: 1, ...this.own, updatedAt: now }
    return { path: this.ownPath(this.own.sessionId), text: JSON.stringify(file) }
  }

  private inWindow(entries: readonly FsEntry[], now: number) {
    const { earliestMs } = ranges(now, this.tzMin)
    const mine = this.own ? `${this.own.sessionId}.json` : ''
    return entries.filter(
      e => e.kind === 'file' && e.name.endsWith('.json') && e.name !== mine && e.mtimeMs >= earliestMs,
    )
  }

  /** The other sessions' files to read: in this month or week, changed since last read. */
  toRead(entries: readonly FsEntry[], now: number): FsEntry[] {
    return this.inWindow(entries, now).filter(e => this.files.get(e.name)?.mtimeMs !== e.mtimeMs)
  }

  ingest(entry: FsEntry, text: string | null) {
    this.files.set(entry.name, { mtimeMs: entry.mtimeMs, days: parseJson<LedgerFile>(text)?.days ?? {} })
  }

  /** Sums the other sessions' days, once their changed files are ingested. */
  settle(entries: readonly FsEntry[], now: number) {
    const r = ranges(now, this.tzMin)
    const sums = { today: 0, week: 0, month: 0 }
    for (const e of this.inWindow(entries, now)) {
      const s = sumDays(this.files.get(e.name)?.days ?? {}, r)
      sums.today += s.today
      sums.week += s.week
      sums.month += s.month
    }
    this.others = sums
    this.retired = { today: 0, week: 0, month: 0 }
  }

  totals(now: number): HudTotals {
    const mine = this.own ? sumDays(this.own.days, ranges(now, this.tzMin)) : { today: 0, week: 0, month: 0 }
    return {
      today: this.others.today + this.retired.today + mine.today,
      week: this.others.week + this.retired.week + mine.week,
      month: this.others.month + this.retired.month + mine.month,
      since: this.since,
    }
  }
}

// Ledger work runs one job at a time, so two cost readings never interleave.
let chain: Promise<unknown> = Promise.resolve()
export const serial = (job: () => Promise<void>): Promise<void> => {
  const run = chain.then(job, job)
  chain = run.catch(() => undefined)
  return run.catch(() => undefined)
}
