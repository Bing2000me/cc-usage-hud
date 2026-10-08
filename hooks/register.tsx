import { atom, read, update } from 'claude-code'
import type { FsEntry, Register, RenderNode, TurnUsage } from 'claude-code'

import type { HudCard, HudLimit } from '../types'
import * as F from './format'
import { buildView, ORDER, pickTier } from './model'
import { cardSvg, iconSvg } from './svg'
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
const CHIP_GAP = 2
// Desktop footer: cells its own controls take, and what each chip adds to its label.
const FOOTER_RESERVED = 48
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
          description: 'Dev only: reloads the cc-usage-hud mod and pins one of its cards open (stats, tokens, limits, cost, or none).',
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

  // Desktop: chips in the prompt footer, each with a card that floats above it on hover.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const { Box, Text, Svg } = $.ui.resolve(e)
    const s = await read($, statsAtom)
    const snap = await read($, snapAtom)
    const totals = await read($, totalsAtom)
    const pinned = await read($, pinnedAtom)
    await read($, tickAtom)
    const now = await $.clock.now()
    const view = buildView(s, snap, totals, now, ledger.tzMin)

    const children: RenderNode[] = []
    if (e.props.modes.length > 0) children.push(<Text dimColor>{e.props.modes.join(' & ')}</Text>)
    // The footer shares its row with the engine's own controls: leave them room.
    const room = (e.viewport?.columns ?? 120) - FOOTER_RESERVED
    const tier = pickTier(view.chips, room, label => F.cellWidth(label) + CHIP_CHROME)
    for (const chip of view.chips) {
      const card = view.cards.find(c => c.id === chip.id)
      if (!card) continue
      const drawing = cardSvg(card)
      const isPinned = pinned === chip.id
      const alt = [card.title, card.right, ...card.rows.map(r => `${r.label} ${r.value}`)].filter(Boolean).join(', ')
      children.push(
        <Box
          key={`chip-${chip.id}`}
          flexDirection="row"
          alignItems="center"
          columnGap={1}
          paddingX={1}
          hover={{ backgroundColor: CHIP_HOVER }}
        >
          <Svg source={iconSvg(chip.icon, 14, chip.ring)} alt="" width={14} height={14} />
          <Text dimColor hover={{ dimColor: false }} wrap="truncate-end">
            {chip.labels[tier]}
          </Text>
          <Box
            position="absolute"
            bottom={1}
            right={0}
            display={isPinned ? 'flex' : 'none'}
            {...(isPinned ? {} : { hover: { display: 'flex' as const } })}
          >
            <Svg source={drawing.source} alt={alt} width={drawing.width} height={drawing.height} />
          </Box>
        </Box>,
      )
    }
    return (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {children}
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
