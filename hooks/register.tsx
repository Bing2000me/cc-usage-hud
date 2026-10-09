import { atom, read, update } from 'claude-code'
import type { FsEntry, Register, RenderNode, TurnUsage } from 'claude-code'

import type { HudCard, HudLimit } from '../types'
import * as F from './format'
import { buildView, ORDER, pickTier } from './model'
import type { Strip, StripItem, Tone } from './model'
import { iconSvg, meterSvg, PAGE_SVG, panelSvg } from './svg'
import { Ledger, parseJson, serial } from './ledger'
import type { LedgerFile, LimitsCache } from './ledger'
import { EMPTY_SNAP, EMPTY_STATS, EMPTY_TOTALS } from './state'

const statsAtom = atom({ plugin: 'cc-usage-hud', key: 'stats' } as const, EMPTY_STATS)
const snapAtom = atom({ plugin: 'cc-usage-hud', key: 'snap' } as const, EMPTY_SNAP)
const totalsAtom = atom({ plugin: 'cc-usage-hud', key: 'totals' } as const, EMPTY_TOTALS)
const ownAtom = atom({ plugin: 'cc-usage-hud', key: 'own' } as const, null)
const pinnedAtom = atom({ plugin: 'cc-usage-hud', key: 'pinned' } as const, null)
const tickAtom = atom({ plugin: 'cc-usage-hud', key: 'tick' } as const, 0)

// Tools whose time is the person's, not the machine's.
const USER_WAIT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const LIMITS_WRITE_EVERY_MS = 30_000
const CARD_WIDTH = 40
// The desktop band: CSS pixels per row and per column, and the smallest the panel is drawn.
const DESKTOP_ROW_PX = 19
const DESKTOP_COL_PX = 7.8
const MIN_PANEL_SCALE = 0.7
// A detail line's meters, in CSS pixels and in the cells they take; cells between figures.
const METER_PX = 36
const METER_CELLS = 5
const STRIP_GAP = 3
// The desktop's proportional text runs narrower than the cells cellWidth counts.
const DESKTOP_TEXT_FIT = 0.88
const CHIP_GAP = 2
// Cells the page layer reaches past the band's body on every side, over its tray.
const PAGE_BLEED = 6
// Cells a desktop chip adds to its label: the icon, its gap and the padding.
const CHIP_CHROME = 5
// Mid-gray at low alpha reads as a pill on both light and dark backgrounds.
const CHIP_HOVER = 'rgba(128,128,128,0.18)'
const GLYPH: Record<string, string> = { gauge: '◷', database: '▦', ring: '◔', timer: '◔', coin: '◇' }

export const register: Register = on => {
  const ledger = new Ledger()
  let refreshQueued = false
  let lastLimitsWrite = 0
  let lastLimitsJson = ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // The dev tool exists only in a copy loaded from a session's hot-reload folder.
    if ($.plugin.root.includes('/.claude/dev-mods/'))
      await $.tool
        .register({
          name: 'hud_dev',
          description: 'Dev only: reloads the cc-usage-hud mod and opens its detail for one chip (stats, tokens, limits, cost, or none).',
          inputSchema: {
            type: 'object',
            properties: { pin: { type: 'string', enum: ['stats', 'tokens', 'limits', 'cost', 'none'] } },
          },
          isDeferred: false,
        })
        .catch(() => undefined)

    // Reads the status line's figures and folds them into the band and the ledger.
    const refresh = () =>
      serial(async () => {
        const usage = await $.session.usage()
        const now = await $.clock.now()
        const fresh: HudLimit[] = usage.rateLimits.map(l => ({
          kind: l.kind,
          percentUsed: l.percentUsed,
          ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}),
        }))
        await update($, snapAtom, s => ({
          costUsd: usage.cost?.usd ?? s.costUsd,
          limits: fresh.length > 0 ? fresh : s.limits,
          limitsAt: fresh.length > 0 ? now : s.limitsAt,
          limitsStale: fresh.length > 0 ? false : s.limitsStale,
          ctxTokens: usage.context.tokens ?? null,
          ctxWindow: usage.context.window ?? null,
          ctxPercent: usage.context.percent ?? null,
        }))
        if (usage.cost) {
          const id = await $.session.id()
          for (const w of ledger.applyCost(usage.cost.usd, now, id)) await $.fs.write(w.path, w.text)
          const own = ledger.own
          if (own) await update($, ownAtom, () => ({ ...own, days: { ...own.days } }))
        }
        await update($, totalsAtom, () => ledger.totals(now))
        if (fresh.length > 0 && ledger.base) {
          const json = JSON.stringify(fresh)
          if (json !== lastLimitsJson && now - lastLimitsWrite >= LIMITS_WRITE_EVERY_MS) {
            lastLimitsJson = json
            lastLimitsWrite = now
            const cache: LimitsCache = { at: now, limits: fresh }
            await $.fs.write(ledger.limitsPath(), JSON.stringify(cache))
          }
        }
      })

    // Re-reads the other sessions' ledgers, flushes this one, moves the countdowns.
    const everyMinute = () =>
      serial(async () => {
        const now = await $.clock.now()
        if (ledger.base) {
          let entries: readonly FsEntry[] = []
          try {
            entries = await $.fs.list(ledger.dir())
          } catch {
            entries = []
          }
          for (const entry of ledger.toRead(entries, now)) {
            let text: string | null = null
            try {
              text = String(await $.fs.read(`${ledger.dir()}/${entry.name}`))
            } catch {
              text = null
            }
            ledger.ingest(entry, text)
          }
          ledger.settle(entries, now)
          const w = ledger.take(now, true)
          if (w) await $.fs.write(w.path, w.text)
        }
        await update($, totalsAtom, () => ledger.totals(now))
        await update($, tickAtom, () => now)
      })

    await serial(async () => {
      const home = await $.env.get('HOME')
      ledger.base = home ? `${home}/.claude/cc-usage-hud` : null
      try {
        const out = await $.process.run(['date', '+%z'])
        const tz = F.parseTz(out.stdout)
        if (tz !== null) ledger.tzMin = tz
      } catch {
        // Keep the environment's own offset.
      }
      const now = await $.clock.now()
      const usage = await $.session.usage()
      const id = await $.session.id()
      const held = await read($, ownAtom)
      let file: LedgerFile | null = null
      let meta: { since?: string } | null = null
      let cached: LimitsCache | null = null
      if (ledger.base) {
        file = parseJson<LedgerFile>(await $.fs.read(ledger.ownPath(id)).then(String, () => null))
        meta = parseJson<{ since?: string }>(await $.fs.read(ledger.metaPath()).then(String, () => null))
        cached = parseJson<LimitsCache>(await $.fs.read(ledger.limitsPath()).then(String, () => null))
      }
      ledger.start(id, held, file, usage.cost?.usd ?? null)
      if (ledger.base) {
        ledger.since = meta?.since ?? F.dayKey(now, ledger.tzMin)
        if (!meta?.since) await $.fs.write(ledger.metaPath(), JSON.stringify({ since: ledger.since }))
      }
      const snap = await read($, snapAtom)
      if (snap.limits.length === 0 && cached && cached.limits.length > 0) {
        const { at, limits } = cached
        await update($, snapAtom, s => ({ ...s, limits, limitsAt: at, limitsStale: true }))
      }
    })
    await everyMinute()
    await refresh()

    $.clock.every(1_500, () => {
      if (!refreshQueued) return
      refreshQueued = false
      refresh().catch(() => undefined)
    })
    $.clock.every(60_000, () => {
      everyMinute().catch(() => undefined)
    })
    return r
  })

  on('turn.start', async ($, e, next) => {
    await update($, statsAtom, s => ({ ...s, turns: s.turns + 1 })).catch(() => undefined)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const t0 = performance.now()
    let tFirst: number | null = null
    let tStop: number | null = null
    let usage: TurnUsage | null = null
    for await (const c of next(e)) {
      if (tFirst === null && c.kind !== 'engine') tFirst = performance.now()
      if (c.kind === 'stop') {
        tStop = performance.now()
        usage = c.usage
      }
      yield c
    }
    const end = tStop ?? performance.now()
    const out = usage?.output_tokens ?? 0
    const genMs = tFirst !== null && tStop !== null ? tStop - tFirst : 0
    // Under a quarter second the clock says more about chunking than speed.
    const isTimed = genMs >= 250 && out > 0
    try {
      await update($, statsAtom, s => {
        const n = { ...s }
        if (usage) {
          n.input += usage.input_tokens
          n.cacheWrite += usage.cache_creation_input_tokens
          n.cacheRead += usage.cache_read_input_tokens
          n.output += usage.output_tokens
        }
        if (isMain) {
          n.steps += 1
          n.modelMs += end - t0
          if (tFirst !== null) {
            n.ttftMs += tFirst - t0
            n.ttftN += 1
          }
          if (isTimed) {
            n.genOut += out
            n.genMs += genMs
            n.lastTps = out / (genMs / 1000)
          }
        } else {
          n.subSteps += 1
          if (isTimed) {
            n.subGenOut += out
            n.subGenMs += genMs
          }
        }
        return n
      })
    } catch {
      // A missed count is better than a stalled turn.
    }
    refreshQueued = true
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || USER_WAIT_TOOLS.has(String(e.tool))) return next(e)
    const t0 = performance.now()
    const result = await next(e)
    const dt = performance.now() - t0
    await update($, statsAtom, s => ({ ...s, toolMs: s.toolMs + dt })).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    refreshQueued = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    refreshQueued = true
    return r
  })

  on('session.end', async ($, e, next) => {
    try {
      const usage = await $.session.usage()
      const now = await $.clock.now()
      const id = await $.session.id()
      const writes = usage.cost ? ledger.applyCost(usage.cost.usd, now, id) : []
      const last = ledger.take(now, true)
      if (last) writes.push(last)
      for (const w of writes) await $.fs.write(w.path, w.text)
    } catch {
      // Exits stay fast; at worst the last few seconds go uncounted.
    }
    return next(e)
  })

  // Dev only: a tool that reloads this mod and pins a card open, for screenshots.
  on('tool.call', { tool: 'mcp__cc-usage-hud__hud_dev' }, async ($, e) => {
    const want = String((e as { pin?: unknown }).pin ?? 'none')
    const pin = (ORDER as string[]).includes(want) ? (want as HudCard) : null
    await update($, pinnedAtom, () => pin)
    return { result: `cc-usage-hud reloaded; pinned: ${pin ?? 'none'}` }
  })

  // Desktop: a row of chips in the band above the prompt, drawn on the page's own
  // background. Hovering a chip opens one line of detail right above it: the band
  // clips anything outside it and grows with what it holds, so one line is the most
  // it takes from the conversation, and the chips never move under the pointer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'desktop') return next(e)
    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    const s = await read($, statsAtom)
    const snap = await read($, snapAtom)
    const totals = await read($, totalsAtom)
    const pinned = await read($, pinnedAtom)
    await read($, tickAtom)
    const now = await $.clock.now()
    const full = buildView(s, snap, totals, now, ledger.tzMin)
    // The desktop shows the plan's limits itself, beside the model picker.
    const isShown = (id: HudCard) => id !== 'limits'
    const view = {
      chips: full.chips.filter(c => isShown(c.id)),
      cards: full.cards.filter(c => isShown(c.id)),
      strips: full.strips.filter(st => isShown(st.id)),
    }

    const cols = e.props.bodyColumns
    const fit = (text: string) => F.cellWidth(text) * DESKTOP_TEXT_FIT
    const tier = pickTier(view.chips, cols, label => fit(label) + CHIP_CHROME)
    const hasRoom = e.props.maxRows >= 2

    // A detail line keeps its notes while they fit, then its leading figures.
    const fitStrip = (strip: Strip) => {
      const itemWidth = (it: StripItem, withNote: boolean) =>
        fit(it.label) + 1 + fit(it.value) + (it.pct !== undefined ? METER_CELLS + 1 : 0) +
        (withNote && it.note ? 1 + fit(it.note) : 0)
      const width = (items: StripItem[], withNote: boolean) =>
        items.reduce((w, it) => w + itemWidth(it, withNote) + STRIP_GAP, 0) +
        (withNote && strip.note ? fit(strip.note) : 0)
      if (width(strip.items, true) <= cols) return { items: strip.items, withNote: true }
      let items = strip.items
      while (items.length > 1 && width(items, false) > cols) items = items.slice(0, -1)
      return { items, withNote: false }
    }

    const tone = (t: Tone | undefined) => (t === 'bad' ? 'error' : t === 'warn' ? 'warning' : undefined)

    // A press on any chip opens the panel of all its cards, set like the desktop's own
    // usage popover; it is laid out in the band, so it is drawn only where it fits.
    const isOpen = pinned !== null
    const panel = panelSvg(view.cards)
    const roomPx = (e.props.maxRows - 1) * DESKTOP_ROW_PX - 4
    const scale = Math.min(1, roomPx / panel.height, (cols * DESKTOP_COL_PX) / panel.width)
    const isPanelShown = isOpen && scale >= MIN_PANEL_SCALE
    const panelAlt = view.cards
      .map(c => [c.title, ...c.meters.map(m => `${m.label} ${m.value}`), ...c.rows.map(r => `${r.label} ${r.value}`)].join(' '))
      .join('; ')

    // Drawn twice: once in the flow, where it sizes the band and lies hidden under the
    // page layer, and once on top of that layer, where it is seen and hovered. Both
    // copies share the hover groups, so they open and close together.
    const content = (isLive: boolean) => {
      const tag = isLive ? '' : '-flow'
      const strips = view.strips.map(strip => {
        const scope = `hud-${strip.id}`
        if (!hasRoom || isOpen) return <Box key={`strip-${strip.id}${tag}`} display="none" />
        const { items, withNote } = fitStrip(strip)
        const parts: RenderNode[] = items.map(it => {
          const bits: RenderNode[] = [<Text dimColor>{it.label}</Text>]
          if (it.pct !== undefined)
            bits.push(
              <Svg
                source={meterSvg(it.pct, it.tone ?? 'ok', METER_PX)}
                alt={`${it.label} ${it.value}`}
                width={METER_PX}
                height={6}
              />,
            )
          bits.push(<Text color={tone(it.tone)}>{it.value}</Text>)
          if (withNote && it.note) bits.push(<Text dimColor>{it.note}</Text>)
          return (
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              {bits}
            </Box>
          )
        })
        if (withNote && strip.note) parts.push(<Text dimColor>{strip.note}</Text>)
        if (parts.length === 0) parts.push(<Text dimColor>—</Text>)
        const isPinned = pinned === strip.id
        return (
          <Box
            key={`strip-${strip.id}${tag}`}
            display={isPinned ? 'flex' : 'none'}
            hover={isPinned ? { scope } : { scope, display: 'flex' }}
            flexDirection="row"
            justifyContent="center"
            alignItems="center"
            columnGap={STRIP_GAP}
          >
            {parts}
          </Box>
        )
      })
      const chips = view.chips.map(chip => (
        <Box
          key={`chip-${chip.id}${tag}`}
          flexDirection="row"
          alignItems="center"
          columnGap={1}
          paddingX={1}
          hover={isLive ? { scope: `hud-${chip.id}`, backgroundColor: CHIP_HOVER } : { scope: `hud-${chip.id}` }}
        >
          <Svg source={iconSvg(chip.icon, 14, chip.ring)} alt={chip.labels[tier]} width={14} height={14} />
          <Button
            key={`press-${chip.id}${tag}`}
            label={chip.labels[tier]}
            plain
            dimColor
            hover={{ scope: `hud-${chip.id}` }}
            onPress={() => update($, pinnedAtom, p => (p === null ? chip.id : null))}
          />
        </Box>
      ))
      const opened: RenderNode[] = isPanelShown
        ? [
            <Box key={`panel${tag}`} flexDirection="row" justifyContent="center">
              <Svg
                source={panel.source}
                alt={panelAlt}
                width={Math.round(panel.width * scale)}
                height={Math.round(panel.height * scale)}
              />
            </Box>,
          ]
        : []
      return (
        <Box flexDirection="column">
          {opened}
          {strips}
          <Box flexDirection="row" justifyContent="center" columnGap={1}>
            {chips}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {content(false)}
        <Box position="absolute" top={-PAGE_BLEED} left={-PAGE_BLEED} right={-PAGE_BLEED} bottom={-PAGE_BLEED}>
          <Svg source={PAGE_SVG} alt="page" width={4000} height={1600} />
        </Box>
        <Box position="absolute" left={0} right={0} bottom={0} flexDirection="column">
          {content(true)}
        </Box>
      </Box>
    )
  })

  // Terminal: a band above the prompt; a chip shows its card on hover or when pressed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'terminal') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, statsAtom)
    const snap = await read($, snapAtom)
    const totals = await read($, totalsAtom)
    const pinned = await read($, pinnedAtom)
    await read($, tickAtom)
    const now = await $.clock.now()
    const view = buildView(s, snap, totals, now, ledger.tzMin)

    const cols = Math.max(20, e.props.bodyColumns)
    const width = Math.min(CARD_WIDTH, cols)
    const label = (c: (typeof view.chips)[number], t: 0 | 1 | 2) => `${GLYPH[c.icon] ?? '·'} ${c.labels[t]}`
    const tier = pickTier(view.chips, cols - CHIP_GAP * (view.chips.length - 1), l => F.cellWidth(l) + 2)

    const offsets = new Map<HudCard, number>()
    let x = 0
    for (const c of view.chips) {
      offsets.set(c.id, Math.max(0, Math.min(x, cols - width)))
      x += F.cellWidth(label(c, tier)) + CHIP_GAP
    }

    const tone = (t: string | undefined) =>
      t === 'bad' ? 'error' : t === 'warn' ? 'warning' : t === 'ok' ? 'success' : undefined
    const row = (l: string, v: string, t?: string) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>{l}</Text>
        <Text color={tone(t)} dimColor={t === 'dim'}>
          {v}
        </Text>
      </Box>
    )

    const cards = view.cards.map(card => {
      const body: RenderNode[] = card.rows.map(r => row(r.label, r.value, r.tone))
      for (const m of card.meters) {
        body.push(row(m.label, m.value, m.tone))
        body.push(<Text color={tone(m.tone)}>{F.bar(m.pct ?? 0, width - 4)}</Text>)
        if (m.note) body.push(<Text dimColor>{m.note}</Text>)
      }
      if (body.length === 0 && card.empty) body.push(<Text dimColor>{card.empty}</Text>)
      const isPinned = pinned === card.id
      return (
        <Box
          key={`card-${card.id}`}
          display={isPinned ? 'flex' : 'none'}
          hover={isPinned ? { scope: `hud-${card.id}` } : { scope: `hud-${card.id}`, display: 'flex' }}
          flexDirection="column"
          marginLeft={offsets.get(card.id) ?? 0}
          width={width}
          borderStyle="round"
          borderColor="subtle"
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{card.title}</Text>
            <Text bold>{card.right}</Text>
          </Box>
          {body}
          {card.foot.map(line => (
            <Text dimColor wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      )
    })

    const chips = view.chips.map(c => (
      <Button
        key={`chip-${c.id}`}
        label={label(c, tier)}
        plain
        dimColor
        hover={{ scope: `hud-${c.id}`, bold: true }}
        onPress={() => update($, pinnedAtom, p => (p === c.id ? null : c.id))}
      />
    ))

    return (
      <Box flexDirection="column">
        {cards}
        <Box flexDirection="row" flexWrap="wrap" columnGap={CHIP_GAP}>
          {chips}
        </Box>
      </Box>
    )
  })
}
