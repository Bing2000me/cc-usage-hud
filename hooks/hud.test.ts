import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import * as F from './format'
import { Ledger } from './ledger'

const DAY = 86_400_000
const T0 = Date.parse('2026-10-09T01:00:00Z') // Friday 09:00 at +08:00
const cents = (usd: number) => Math.round(usd * 100)

describe('format', () => {
  test('counts and money read as the band shows them', () => {
    expect(F.fmtTok(3_678_039)).toBe('3.7M')
    expect(F.fmtTok(164_000)).toBe('164K')
    expect(F.fmtTok(1_000_000)).toBe('1M')
    expect(F.fmtInt(3_678_039)).toBe('3,678,039')
    expect(F.fmtUsd(1.234)).toBe('$1.23')
    expect(F.fmtUsd(0.001)).toBe('<$0.01')
    expect(F.fmtDur(671_000)).toBe('11分11秒')
    expect(F.fmtDur(7_300)).toBe('7.3秒')
    expect(F.cellWidth('缓存命中 96%')).toBe(12)
  })

  test('hit rate is cache reads over every input token', () => {
    expect(Math.round(F.hitRate({ input: 128_733, cacheWrite: 0, cacheRead: 3_507_456 }) ?? 0)).toBe(96)
    expect(F.hitRate({ input: 0, cacheWrite: 0, cacheRead: 0 })).toBe(null)
  })

  test('days, weeks and months are local, weeks from Monday', () => {
    const r = F.ranges(Date.parse('2026-10-08T18:30:00Z'), 480) // Friday 02:30 at +08:00
    expect(r.today).toBe('2026-10-09')
    expect(r.weekStart).toBe('2026-10-05')
    expect(r.monthStart).toBe('2026-10-01')
    expect(F.parseTz('+0800')).toBe(480)
    expect(F.parseTz('-0330')).toBe(-210)
  })

  test('reset countdowns name the local time', () => {
    const now = Date.parse('2026-10-08T18:30:00Z')
    expect(F.fmtReset('2026-10-08T20:43:00Z', now, 480)).toBe('2小时13分后重置 · 04:43')
    expect(F.fmtReset('2026-10-11T00:00:00Z', now, 480)).toBe('2天5小时后重置 · 10/11 08:00')
    expect(F.fmtReset('2026-10-08T18:00:00Z', now, 480)).toBe('已重置')
  })
})

describe('ledger', () => {
  const fresh = (startCost: number | null = 0) => {
    const l = new Ledger()
    l.base = '/hud'
    l.tzMin = 480
    l.start('s1', null, null, startCost)
    return l
  }

  test('records growth per day and never revisits a past day', () => {
    const l = fresh()
    expect(l.applyCost(1, T0, 's1')).toHaveLength(1)
    expect(l.applyCost(1.5, T0 + 1_000, 's1')).toHaveLength(0) // within five seconds of the last write
    expect(cents(l.totals(T0).today)).toBe(150)
    l.applyCost(2, T0 + DAY, 's1')
    const next = l.totals(T0 + DAY)
    expect(cents(next.today)).toBe(50)
    expect(cents(next.week)).toBe(200)
    expect(cents(next.month)).toBe(200)
  })

  test('a resumed session does not count its restored cost again', () => {
    const l = fresh(3)
    l.applyCost(3.2, T0, 's1')
    expect(cents(l.totals(T0).today)).toBe(20)
  })

  test('a hot reload keeps the ledger it held', () => {
    const l = new Ledger()
    l.start('s1', { sessionId: 's1', lastTotal: 2, days: { '2026-10-09': 2 } }, null, 2)
    l.applyCost(2.5, T0, 's1')
    expect(cents(l.totals(T0).today)).toBe(250)
  })

  test('a total that started over counts from zero', () => {
    const l = fresh()
    l.applyCost(2, T0, 's1')
    l.applyCost(0.3, T0 + 10_000, 's1')
    expect(cents(l.totals(T0 + 10_000).today)).toBe(230)
  })

  test('/clear writes the old file and keeps counting it', () => {
    const l = fresh()
    l.applyCost(1, T0, 's1')
    l.applyCost(1.2, T0 + 1_000, 's1')
    const writes = l.applyCost(1.4, T0 + 2_000, 's2')
    expect(writes.map(w => w.path)).toEqual(['/hud/ledger/s1.json'])
    expect(cents(l.totals(T0 + 2_000).today)).toBe(140)
    expect(l.take(T0 + 2_000, true)?.path).toBe('/hud/ledger/s2.json')
  })

  test('other sessions are summed from their files', () => {
    const l = fresh()
    const entries = [
      { name: 'a.json', kind: 'file' as const, size: 1, mtimeMs: T0, isLink: false },
      { name: 'old.json', kind: 'file' as const, size: 1, mtimeMs: T0 - 40 * DAY, isLink: false },
      { name: 's1.json', kind: 'file' as const, size: 1, mtimeMs: T0, isLink: false },
    ]
    expect(l.toRead(entries, T0).map(e => e.name)).toEqual(['a.json'])
    l.ingest(entries[0], JSON.stringify({ days: { '2026-10-09': 1, '2026-10-06': 2, '2026-09-30': 4 } }))
    l.settle(entries, T0)
    const t = l.totals(T0)
    expect(cents(t.today)).toBe(100)
    expect(cents(t.week)).toBe(300)
    expect(cents(t.month)).toBe(300)
    expect(l.toRead(entries, T0)).toHaveLength(0)
  })
})

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
}

const usage = {
  input_tokens: 100,
  output_tokens: 60,
  cache_read_input_tokens: 2_400,
  cache_creation_input_tokens: 500,
  model: 'claude-opus-5-5',
}

/** One main-thread turn of one step, streamed slowly enough to have a speed. */
const oneStep = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    yield { kind: 'text' as const, index: 0, text: 'hi' }
    const started = performance.now()
    while (performance.now() - started < 300) {
      // Let real time pass.
    }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    expect(chunk.kind === 'text' || chunk.kind === 'stop').toBe(true)
  }
}

test('the terminal band shows the chips, and a pressed chip pins its card', async ($, on) => {
  mock.clock(on, { now: T0 })
  await oneStep($, on)
  const ui = await $.ui.mount({ plugin: 'cc-usage-hud', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'chip-stats' }))?.text).toMatch(/^◷ 1 轮 1 步 · \d+ tok\/s$/)
  expect((await ui.find({ key: 'chip-tokens' }))?.text).toBe('▦ 3.1K tok · 缓存命中 80%')
  expect((await ui.find({ key: 'chip-limits' }))?.text).toBe('◔ 限额 —')
  expect((await ui.find({ key: 'chip-cost' }))?.text).toBe('◇ $0.00 · 今日 $0.00 · 本周 $0.00')
  expect((await ui.find({ key: 'card-cost' }))?.props.display).toBe('none')

  await ui.press({ key: 'chip-cost' })
  expect((await ui.find({ key: 'card-cost' }))?.props.display).toBe('flex')
  expect(await ui.find({ type: 'Text', text: '本月' })).toBeDefined()
  await ui.press({ key: 'chip-cost' })
  expect((await ui.find({ key: 'card-cost' }))?.props.display).toBe('none')
  await ui.unmount()
})

test('the desktop band shows three chips of figures, nothing to press', async ($, on) => {
  mock.clock(on, { now: T0 })
  await oneStep($, on)
  const band = (bodyColumns: number) =>
    $.ui.mount({ plugin: 'cc-usage-hud', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns } })

  const wide = await band(120)
  expect(await wide.find({ type: 'Text', text: '3.1K tok · 缓存命中 80%' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: '$0.00 · 今日 $0.00 · 本周 $0.00' })).toBeDefined()
  // The desktop shows the plan's limits itself: no limits chip.
  expect(await wide.find({ key: 'chip-limits' })).toBe(undefined)
  expect(await wide.findAll({ type: 'Button' })).toHaveLength(0)
  // Icons in the hidden flow copy and the live copy, the page layer, the drop spacer.
  expect(await wide.findAll({ type: 'Svg' })).toHaveLength(8)
  await wide.unmount()

  const mid = await band(62)
  expect(await mid.find({ type: 'Text', text: '3.1K · 命中 80%' })).toBeDefined()
  await mid.unmount()

  const small = await band(40)
  expect(await small.find({ type: 'Text', text: '命中 80%' })).toBeDefined()
  await small.unmount()
})

test('a narrow band steps down to shorter chips', async ($, on) => {
  mock.clock(on, { now: T0 })
  const band = (bodyColumns: number) =>
    $.ui.mount({ plugin: 'cc-usage-hud', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns } })
  const mid = await band(60)
  expect((await mid.find({ key: 'chip-tokens' }))?.text).toBe('▦ 0 · 命中 —')
  await mid.unmount()
  const small = await band(40)
  expect((await small.find({ key: 'chip-tokens' }))?.text).toBe('▦ 命中 —')
  expect((await small.find({ key: 'chip-cost' }))?.text).toBe('◇ $0.00')
  await small.unmount()
})

test('a survey has the band to itself', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'survey' }, 'survey')
  })
  const ui = await $.ui.mount({
    plugin: 'cc-usage-hud',
    surface: 'terminal',
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(await ui.find({ key: 'chip-stats' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'survey' })).toBeDefined()
  await ui.unmount()
})
