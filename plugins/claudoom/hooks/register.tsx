import type { Elements, On, Timer, UiBlitArgs } from 'claude-code'

import * as Doom from './doom'
import { bannerWords, encode, fitGrid, fitWords, paintedRowsOf, wordsOf, type Grid } from './frame'
import { ACTION_HOTKEYS, WEAPON_HOTKEYS, pressesOf, tmuxKeyOf } from './keys'

const PANE_ID = 'claudoom'
const SCREEN_KEY = 'screen'
const CONTROLS_KEY = 'controls'
const FRAME_MS = 33
// A capture can fail once while tmux is busy; only a run of failures means
// the game quit.
const FAILURES_TO_END = 3
// Controls under the screen: all three rows when the pane has room for the
// whole frame, only the movement row when it does not.
const FULL_CONTROL_ROWS = 3
const TIGHT_CONTROL_ROWS = 1
// The drawing is always one row taller than the pane's body, whatever the
// picture's size. An inline pane is as tall as its content up to what the
// layout spares, so content sized from the body would shrink the body with
// it; and the arrows only raise `ui.scroll` while there is a row to scroll.
const CONTENT_ROWS = Doom.GRID.rows + FULL_CONTROL_ROWS + 1
// A height change alone does not redraw a pane, so redraw on a clock to pick
// one up: every 15th frame, twice a second.
const RELAYOUT_EVERY_TICKS = 15

const LOADING = ['C L A U D O O M', '', 'loading…']

/**
 * What the frame loop needs from `$` after the hook that started it returned.
 * `$` itself may not be kept (the engine refuses a module that stores it), so
 * `session.start` binds one closure per call, each spelling `$` out.
 */
type Host = {
  run: Doom.Run
  files: Doom.Files
  home: () => Promise<string | undefined>
  every: (ms: number, fn: () => void) => Timer
  blit: (args: UiBlitArgs) => Promise<unknown>
  invalidate: () => void
  closePane: () => Promise<void>
  log: (text: string) => void
}

/**
 * `/claudoom` opens a pane holding the game: a Raster repainted with each
 * captured frame, scaled to the room the pane has, and the controls under it.
 */
export function register(on: On) {
  let host: Host | null = null
  let session = ''
  let frame: Uint32Array | null = null
  let view: Grid = Doom.GRID
  let timer: Timer | null = null
  let isOpen = false
  let isCapturing = false
  let isInstalling = false
  let failures = 0
  let fullRows = 0
  let ticks = 0

  const run: Doom.Run = (argv, init) =>
    host ? host.run(argv, init) : Promise.reject(new Error('doom: no session yet'))

  const press = (key: string): void => {
    void Doom.sendKeys(run, session, [key]).catch(() => undefined)
  }

  async function paths(): Promise<Doom.Paths> {
    return Doom.pathsOf((await host?.home()) ?? '')
  }

  /** The Raster's cells at the size it is drawn: the last whole frame, or the banner. */
  function cellsFor(grid: Grid): string {
    return encode(frame ? fitWords(frame, Doom.GRID, grid) : bannerWords(LOADING, grid))
  }

  async function tick(): Promise<void> {
    if (!host || !isOpen || isCapturing) return
    isCapturing = true
    ticks++
    if (ticks % RELAYOUT_EVERY_TICKS === 0) host.invalidate()
    try {
      const { frame: text, error } = await Doom.capture(run, session)
      if (text === undefined) {
        failures++
        // Say what tmux said the first time: a game that quit and a tmux whose
        // capture-pane has no -N both end here, looking identical.
        if (failures === 1 && error) host.log(`claudoom: reading the game's screen failed: ${error}`)
        if (failures >= FAILURES_TO_END) await endGame('claudoom exited.')
        return
      }
      failures = 0
      // A torn capture paints fewer rows than a whole frame; keep the last
      // whole one on screen instead.
      const rows = paintedRowsOf(text)
      if (rows < fullRows) return
      fullRows = rows
      frame = wordsOf(text, Doom.GRID)
      await host.blit({ requestId: PANE_ID, key: SCREEN_KEY, cells: cellsFor(view) })
    } catch {
      // A missed frame is harmless; the next tick paints over it.
    } finally {
      isCapturing = false
    }
  }

  function startLoop(): void {
    stopLoop()
    timer = host?.every(FRAME_MS, () => {
      void tick()
    }) ?? null
  }

  function stopLoop(): void {
    timer?.cancel()
    timer = null
  }

  /** Stops the loop and the game; leaves the pane to whoever is closing it. */
  async function stopGame(): Promise<void> {
    stopLoop()
    isOpen = false
    await Doom.stop(run, session)
  }

  async function endGame(note?: string): Promise<void> {
    const wasOpen = isOpen
    await stopGame()
    if (wasOpen && host) {
      await host.closePane().catch(() => undefined)
      if (note) host.log(note)
    }
  }

  on('session.start', async ($, e, next) => {
    host = {
      run: (argv, init) => $.process.run(argv, init),
      files: {
        exists: path => $.fs.exists(path),
        read: path => $.fs.read(path),
        write: (path, text) => $.fs.write(path, text),
      },
      home: () => $.env.get('HOME'),
      every: (ms, fn) => $.clock.every(ms, fn),
      blit: args => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
      closePane: () => $.ui.close({ id: PANE_ID }),
      log: text => $.ui.log(text),
    }
    session = `claudoom-${(await $.session.id()).slice(0, 8)}`
    await $.command.register({
      name: 'claudoom',
      description: 'Play Doom-engine WADs (Freedoom by default) in a pane beside the conversation',
      argumentHint: '[freedoom2 | <file.wad> | install [shareware] | stop | uninstall]',
    })

    // A reload (the plugin folder saved under --plugin-dir) runs this again
    // with fresh state while the pane stays open: pick the running game back up.
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE_ID) && (await Doom.isRunning(run, session))) {
      isOpen = true
      startLoop()
    }

    return next(e)
  })

  on('command.run', { command: 'claudoom' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', option = '', consent = ''] = args.toLowerCase().split(/\s+/)
    const bound = host
    if (!bound) return { text: 'claudoom is not ready: this session has not started yet.' }

    if (verb === 'stop') {
      await endGame()
      return { text: 'claudoom stopped.' }
    }

    if (verb === 'uninstall') {
      if (isInstalling) return { text: 'claudoom is installing; run /claudoom uninstall once it finishes.' }
      await endGame()
      const installed = await paths()
      const { removed, kept } = await Doom.uninstall(run, bound.files, installed)
      if (removed.length === 0) return { text: `Nothing to remove: claudoom has no files in ${installed.dir}.` }
      const left = kept.length > 0 ? ` Left in place, not claudoom's: ${kept.join(', ')}.` : ' The folder is gone.'
      return {
        text: `Removed ${removed.join(', ')} from ${installed.dir}.${left} The plugin itself stays installed; remove it with /plugin. If a game ever outlives its session, "tmux -L claudoom kill-server" stops it.`,
      }
    }

    if (!(await Doom.hasTmux(run))) {
      return { text: 'claudoom runs inside tmux, and tmux is not on PATH. Install it (brew install tmux), then run /claudoom again.' }
    }

    const where = await paths()

    if (verb === 'install') {
      const isShareware = option === 'shareware'
      if (isShareware && consent !== 'accept') return { text: Doom.SHAREWARE_TERMS }
      if (isInstalling) return { text: 'claudoom is still installing.' }
      isInstalling = true
      const fetchWad = isShareware ? Doom.fetchShareware : Doom.fetchFreedoom
      const installed = isShareware ? 'The shareware episode' : 'Freedoom'
      void (async () => (await Doom.buildEngine(run, bound.files, where)) ?? (await fetchWad(run, bound.files, where)))()
        .then(error => bound.log(error ? `claudoom install failed: ${error}` : `${installed} is installed. Run /claudoom to play.`))
        .catch(error => bound.log(`claudoom install failed: ${String(error)}`))
        .finally(() => {
          isInstalling = false
        })
      return {
        text: isShareware
          ? `Downloading id's shareware archive into ${where.dir}, under the terms shown.`
          : `Installing into ${where.dir}: building doom-cli (GPLv2, built from upstream source) and downloading Freedoom (BSD, about 25 MB). This takes a minute or two.`,
      }
    }

    if (isOpen) {
      await endGame()
      return { text: 'claudoom closed.' }
    }

    // `/claudoom freedoom2` or `/claudoom <path to a .wad>` picks the game; a bare
    // `/claudoom` plays the shareware episode if it was installed, else Freedoom.
    const home = (await bound.home()) ?? ''
    const chosen =
      verb === 'freedoom' ? where.freedoom1
      : verb === 'freedoom2' ? where.freedoom2
      : verb.endsWith('.wad') ? args.replace(/^~(?=\/)/, home)
      : undefined
    if (verb && !chosen) {
      return { text: 'Usage: /claudoom [freedoom | freedoom2 | <file.wad> | install [shareware] | stop | uninstall]' }
    }

    const wad = await Doom.wadOf(bound.files, where, chosen)
    if (chosen && !wad) return { text: `There is no WAD at ${chosen}.` }
    if (!wad || !(await bound.files.exists(where.bin))) {
      return {
        text: `claudoom is not installed in ${where.dir}. Run /claudoom install: it builds doom-cli (GPLv2, built from upstream source) and downloads Freedoom, a free BSD-licensed game for this engine. The shareware episode is opt-in: /claudoom install shareware.`,
      }
    }

    const error = await Doom.start(run, session, where, wad)
    if (error) return { text: `claudoom did not start: ${error}` }

    frame = null
    failures = 0
    fullRows = 0
    isOpen = true
    await $.ui.open({
      id: PANE_ID,
      title: 'claudoom',
      focus: true,
      rows: CONTENT_ROWS - 1,
      columns: Doom.GRID.columns,
    })
    startLoop()

    return {
      text: 'claudoom is running and its pane has the keys: WASD or ↑↓ move, F fire, E use, Enter or R select, Q menu. Esc hands the keys back, ctrl+x tab takes them again, /claudoom closes it.',
    }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)

    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>claudoom draws on the terminal only.</Text>
    }

    const { Box, Button, Raster, Client, Text } = $.ui.resolve(e) as Elements['terminal']
    const bodyRows = e.props.scroll.bodyRows
    const isRoomy = bodyRows >= Doom.GRID.rows + FULL_CONTROL_ROWS
    const controlRows = isRoomy ? FULL_CONTROL_ROWS : TIGHT_CONTROL_ROWS
    view = fitGrid(Doom.GRID, { columns: e.props.bodyColumns, rows: Math.max(1, bodyRows - controlRows) })
    const spacerRows = Math.max(CONTENT_ROWS, bodyRows + 1) - view.rows - controlRows

    const buttonsOf = (entries: typeof ACTION_HOTKEYS) =>
      entries.map(entry => (
        <Button
          key={`key-${entry.hotkey}`}
          hotkey={entry.hotkey}
          label={entry.label}
          plain
          dimColor
          // Enter presses the focused Button, so the ring starts on Doom's own
          // Enter: menus select with the key a player reaches for.
          autoFocus={entry.hotkey === 'r' ? true : undefined}
          onPress={() => press(entry.tmux)}
        />
      ))

    return (
      <Box flexDirection="column">
        <Raster key={SCREEN_KEY} columns={view.columns} rows={view.rows} cells={cellsFor(view)} />
        <Box flexDirection="row" gap={1}>
          {e.props.isFocused ? <Text color="green">●</Text> : <Text dimColor>○</Text>}
          {buttonsOf(ACTION_HOTKEYS)}
        </Box>
        {isRoomy && (
          <Box flexDirection="row" gap={1}>
            {buttonsOf(WEAPON_HOTKEYS)}
          </Box>
        )}
        {isRoomy && <Client key={CONTROLS_KEY} module="./controls.tsx" height={1} />}
        <Box key="spacer" height={spacerRows} flexShrink={0} />
      </Box>
    )
  })

  // A focused pane keeps the arrow keys for scrolling. Each one still arrives
  // here as a one-row scroll of this pane: hand ↑/↓ to the game and keep the
  // pane still. A wheel (it carries a pointer) or a page key moves nothing either.
  on('ui.scroll', { requestId: PANE_ID }, ($, e, next) => {
    if (!isOpen || e.origin.kind !== 'person') return next(e)
    if (!e.pointer && Math.abs(e.by) === 1) press(e.by < 0 ? 'Up' : 'Down')
    return {}
  })

  on('ui.message', ($, e, next) => {
    if (e.requestId !== PANE_ID || e.element !== CONTROLS_KEY) return next(e)
    const keys = pressesOf(e.data).flatMap(press => tmuxKeyOf(press) ?? [])
    void Doom.sendKeys(run, session, keys).catch(() => undefined)
    return {}
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    await stopGame()
    return result
  })

  on('session.end', async ($, e, next) => {
    await stopGame()
    return next(e)
  })
}
