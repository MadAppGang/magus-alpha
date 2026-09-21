import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { Grid } from './frame'

/**
 * doom-cli, a native build of doomgeneric that draws to a terminal, driven
 * through a tmux server of the mod's own. `$.process.run` is one-shot, so a
 * game that keeps running cannot be streamed; a detached tmux session holds
 * it, `capture-pane` reads a frame, `send-keys` types into it.
 */

export type Run = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

export type Files = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
}

export type Paths = {
  dir: string
  bin: string
  repo: string
  downloads: string
  freedoom1: string
  freedoom2: string
  shareware: string
}

// 80 columns in quadrant mode is 160x52 pixels: 26 rows of 2x2 cells.
export const GRID: Grid = { columns: 80, rows: 26 }

// The window is taller than the frame so doom-cli's trailing newline never
// scrolls the first row away.
const WINDOW_ROWS = 30

// A socket of its own keeps the game out of the person's `tmux ls`, and
// `-f /dev/null` keeps their tmux.conf from changing what a capture holds.
const TMUX = ['tmux', '-L', 'claudoom', '-f', '/dev/null'] as const

// Every download is pinned and verified before anything is built, kept or run,
// so an upstream change or a swapped file fails the install instead of running
// something nobody reviewed.

// doom-cli is GPLv2. Its source is fetched from upstream and built on the
// person's own machine; the plugin ships none of it. The source arrives as the
// tarball of one pinned commit over HTTPS, never through git: a person's git
// config may rewrite github URLs to SSH, and then a clone needs their agent.
//
// What is pinned is the digest of the EXTRACTED TREE, not of the tarball: a
// forge may re-compress an archive it serves for the same commit, which changes
// the tarball's bytes and nothing inside it. This digest is the sha256 of the
// sorted per-file sha256 list, so it survives that and still fails closed on a
// changed file. Recompute it with the command in DOOM_CLI.digestCommand.
const DOOM_CLI = {
  commit: '018e1edf67a093f8ac48e57591eb934e9bc01b26',
  tarball: 'https://codeload.github.com/ludocode/doom-cli/tar.gz/018e1edf67a093f8ac48e57591eb934e9bc01b26',
  sourceSha256: 'a83bdb933f32601b2fab63b23b0cd6bc07cdbc77dcf5fe9de23fc7898cb2a9d4',
  digestCommand: 'find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256',
}

// Freedoom is 3-clause BSD: free to fetch and keep, with its COPYING notice.
// The digest is the one in the release's PGP-signed freedoom-0.13.0-CHECKSUM.
const FREEDOOM = {
  url: 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
  sha256: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',
  folder: 'freedoom-0.13.0',
}

// id's own v1.9 shareware archive from /idgames. Its licence allows electronic
// distribution "only in compressed format", so the archive is fetched and
// unpacked here, never a bare WAD from a mirror. The WAD digest is v1.9's.
const SHAREWARE = {
  url: 'https://www.gamers.org/pub/idgames/idstuff/doom/doom19s.zip',
  sha256: 'cacf0142b31ca1af00796b4a0339e07992ac5f21bc3f81e7532fe1b5e1b486e6',
  wadSha1: '5b2e249b9c5133ec987b3ea77596381dc0d6bc1d',
}

/** What `/claudoom install shareware` shows before anything is downloaded. */
export const SHAREWARE_TERMS = [
  "The shareware episode (DOOM1.WAD) is id Software's, and it is not free software.",
  "Its licence (LICENSE.DOC, shipped with id's v1.8 shareware; the v1.9 archive carries none) lets you play it and copy it for others,",
  'and share it electronically, royalty free, "only in compressed format". It forbids modifying it (§1),',
  'any commercial use (§2, "Commercial Use is Prohibited"), and charging anyone for it without "ID\'s prior written consent" (§4).',
  "To accept those terms and download id's original doom19s.zip from /idgames, run /claudoom install shareware accept.",
].join(' ')

// mempcpy is a GNU extension macOS lacks.
const MEMPCPY_PATCH = `
#ifndef mempcpy
static inline void* mempcpy_compat(void* dest, const void* src, size_t n) {
    memcpy(dest, src, n);
    return (char*)dest + n;
}
#define mempcpy mempcpy_compat
#endif
`

export function pathsOf(home: string): Paths {
  const dir = `${home}/.claude/claudoom`
  return {
    dir,
    bin: `${dir}/doomgeneric`,
    repo: `${dir}/repo`,
    downloads: `${dir}/downloads`,
    freedoom1: `${dir}/freedoom1.wad`,
    freedoom2: `${dir}/freedoom2.wad`,
    shareware: `${dir}/DOOM1.WAD`,
  }
}

async function succeeds(run: Run, argv: readonly string[], init?: ProcessRunInit): Promise<boolean> {
  try {
    return (await run(argv, init)).exitCode === 0
  } catch {
    return false
  }
}

export function hasTmux(run: Run): Promise<boolean> {
  return succeeds(run, ['tmux', '-V'])
}

async function missingTool(run: Run, tools: readonly string[]): Promise<string | undefined> {
  for (const tool of tools) {
    if (!(await succeeds(run, ['which', tool]))) return `${tool} is not installed`
  }
  return undefined
}

async function digestOf(run: Run, algorithm: '1' | '256', path: string): Promise<string | undefined> {
  const result = await run(['shasum', '-a', algorithm, path])
  return result.exitCode === 0 ? result.stdout.split(/\s+/)[0] : undefined
}

// `-L` follows redirects, so the scheme is pinned too: a redirect to plain http
// is refused rather than followed.
const CURL = ['curl', '-fsSL', '--proto', '=https', '--proto-redir', '=https'] as const

/** Downloads a file and refuses it unless its SHA-256 is the pinned one. */
async function fetchChecked(run: Run, url: string, sha256: string, to: string): Promise<string | undefined> {
  const fetched = await run([...CURL, '-o', to, url], { timeoutMs: 300_000 })
  if (fetched.exitCode !== 0) return `downloading ${url} failed: ${fetched.stderr.trim()}`
  const digest = await digestOf(run, '256', to)
  if (digest !== sha256) {
    await run(['rm', '-f', to])
    return `${url} does not match its pinned SHA-256 (got ${digest ?? 'nothing'}); nothing was installed`
  }
  return undefined
}

/**
 * The WAD `/claudoom` plays: one the person named, else the shareware episode if
 * they opted in to it, else Freedoom.
 */
export async function wadOf(files: Files, paths: Paths, chosen?: string): Promise<string | undefined> {
  const candidates = chosen ? [chosen] : [paths.shareware, paths.freedoom1]
  for (const wad of candidates) {
    if (await files.exists(wad)) return wad
  }
  return undefined
}

/** Fetches doom-cli at the pinned commit, patches it for macOS and builds it. */
export async function buildEngine(run: Run, files: Files, paths: Paths): Promise<string | undefined> {
  if (await files.exists(paths.bin)) return undefined

  const missing = await missingTool(run, ['curl', 'tar', 'make', 'shasum'])
  if (missing) return missing

  await run(['mkdir', '-p', paths.dir])

  // The source lands in a staging directory and is verified there. `repo`
  // itself appears only once the tree is whole and checked, so an interrupted
  // install leaves nothing that a later run reads as "the source is present".
  if (!(await files.exists(paths.repo))) {
    const staging = `${paths.repo}.partial`
    const abandon = async (why: string) => {
      await run(['rm', '-rf', staging, paths.downloads])
      return why
    }

    await run(['rm', '-rf', staging])
    await run(['mkdir', '-p', paths.downloads, staging])

    const tarball = `${paths.downloads}/doom-cli.tar.gz`
    const fetched = await run([...CURL, '-o', tarball, DOOM_CLI.tarball], { timeoutMs: 180_000 })
    if (fetched.exitCode !== 0) {
      return abandon(`downloading doom-cli ${DOOM_CLI.commit.slice(0, 8)} failed: ${fetched.stderr.trim()}`)
    }

    const unpacked = await run(['tar', '-xzf', tarball, '-C', staging, '--strip-components=1'])
    if (unpacked.exitCode !== 0) return abandon(`unpacking doom-cli failed: ${unpacked.stderr.trim()}`)

    // The script text is fixed here and the directory travels as an argument.
    const digested = await run(['sh', '-c', `cd "$1" && ${DOOM_CLI.digestCommand}`, 'sh', staging])
    const digest = digested.stdout.split(/\s+/)[0]
    if (digest !== DOOM_CLI.sourceSha256) {
      return abandon(
        `doom-cli ${DOOM_CLI.commit.slice(0, 8)} does not match its pinned source digest ` +
          `(got ${digest || 'nothing'}); nothing was built`,
      )
    }

    const staged = await run(['mv', staging, paths.repo])
    if (staged.exitCode !== 0) return abandon(`staging doom-cli failed: ${staged.stderr.trim()}`)
    await run(['rm', '-rf', paths.downloads])
  }

  const source = `${paths.repo}/doomgeneric/doomgeneric_cli.c`
  if (await files.exists(source)) {
    const text = await files.read(source)
    if (text.includes('mempcpy') && !text.includes('mempcpy_compat')) {
      const lineEnd = text.indexOf('\n', text.lastIndexOf('#include'))
      await files.write(source, text.slice(0, lineEnd + 1) + MEMPCPY_PATCH + text.slice(lineEnd + 1))
    }
  }

  const build = await run(['make', '-f', 'Makefile.cli'], {
    cwd: `${paths.repo}/doomgeneric`,
    env: { CFLAGS: '-Wno-absolute-value' },
    timeoutMs: 300_000,
  })
  if (build.exitCode !== 0) {
    // Both ends of the build log: a missing compiler or header says so in the
    // first lines, and make's own "Error 1" is all the last lines carry.
    const lines = build.stderr.trim().split('\n')
    const said = lines.length > 6 ? [...lines.slice(0, 3), '…', ...lines.slice(-3)] : lines
    return `make failed: ${said.join(' ')}`
  }

  const copy = await run(['cp', `${paths.repo}/doomgeneric/doomgeneric`, paths.bin])
  if (copy.exitCode !== 0) return `copying the binary failed: ${copy.stderr.trim()}`

  return undefined
}

/** Fetches the Freedoom release, checks it, and keeps both WADs and the licence. */
export async function fetchFreedoom(run: Run, files: Files, paths: Paths): Promise<string | undefined> {
  const copying = `${paths.dir}/${FREEDOOM_COPYING}`
  // All three, so a half-finished install repairs itself on the next run
  // instead of reporting success with a WAD or the licence notice missing.
  const kept = [paths.freedoom1, paths.freedoom2, copying]
  if ((await Promise.all(kept.map(path => files.exists(path)))).every(Boolean)) return undefined

  const missing = await missingTool(run, ['curl', 'shasum', 'unzip'])
  if (missing) return missing

  await run(['mkdir', '-p', paths.downloads])
  const zip = `${paths.downloads}/${FREEDOOM.folder}.zip`
  const error = await fetchChecked(run, FREEDOOM.url, FREEDOOM.sha256, zip)
  if (error) return error

  const members = ['freedoom1.wad', 'freedoom2.wad', 'COPYING.txt'].map(name => `${FREEDOOM.folder}/${name}`)
  const unpacked = await run(['unzip', '-o', '-j', zip, ...members, '-d', paths.downloads], { timeoutMs: 120_000 })
  if (unpacked.exitCode !== 0) return `unpacking Freedoom failed: ${unpacked.stderr.trim()}`

  for (const [from, to] of [
    ['freedoom1.wad', paths.freedoom1],
    ['freedoom2.wad', paths.freedoom2],
    ['COPYING.txt', copying],
  ] as const) {
    const moved = await run(['mv', `${paths.downloads}/${from}`, to])
    if (moved.exitCode !== 0) return `keeping ${from} failed: ${moved.stderr.trim()}`
  }

  await run(['rm', '-rf', paths.downloads])
  return undefined
}

/**
 * Fetches id's shareware archive, joins the two halves of its 1995 installer
 * (one LHA archive, which macOS `tar` reads) and keeps only the WAD, checked.
 */
export async function fetchShareware(run: Run, files: Files, paths: Paths): Promise<string | undefined> {
  if (await files.exists(paths.shareware)) return undefined

  const missing = await missingTool(run, ['curl', 'shasum', 'unzip', 'tar'])
  if (missing) return missing

  await run(['mkdir', '-p', paths.downloads])
  const zip = `${paths.downloads}/doom19s.zip`
  const error = await fetchChecked(run, SHAREWARE.url, SHAREWARE.sha256, zip)
  if (error) return error

  const parts = ['DOOMS_19.1', 'DOOMS_19.2']
  const unzipped = await run(['unzip', '-o', zip, ...parts, '-d', paths.downloads])
  if (unzipped.exitCode !== 0) return `unpacking doom19s.zip failed: ${unzipped.stderr.trim()}`

  const lzh = `${paths.downloads}/dooms19.lzh`
  const [first, second] = parts.map(part => `${paths.downloads}/${part}`)
  // The paths travel as arguments, never inside the script text.
  const joined = await run(['sh', '-c', 'cat "$1" "$2" > "$3"', 'sh', first!, second!, lzh])
  if (joined.exitCode !== 0) return `joining the installer halves failed: ${joined.stderr.trim()}`

  const extracted = await run(['tar', '-xf', lzh, '-C', paths.downloads, 'DOOM1.WAD'])
  if (extracted.exitCode !== 0) return `extracting DOOM1.WAD failed: ${extracted.stderr.trim()}`

  const wad = `${paths.downloads}/DOOM1.WAD`
  const digest = await digestOf(run, '1', wad)
  if (digest !== SHAREWARE.wadSha1) {
    await run(['rm', '-rf', paths.downloads])
    return `DOOM1.WAD is not the v1.9 shareware file (SHA-1 ${digest ?? 'unreadable'}); nothing was installed`
  }

  await run(['mv', wad, paths.shareware])
  await run(['rm', '-rf', paths.downloads])
  return undefined
}

/** Freedoom's licence notice, kept beside its WADs. */
export const FREEDOOM_COPYING = 'freedoom-COPYING.txt'

/**
 * Removes what `install` wrote, by name, and nothing else: a file the person
 * put in the folder themselves stays, and so does the folder around it.
 */
export async function uninstall(run: Run, files: Files, paths: Paths): Promise<{ removed: string[]; kept: string[] }> {
  const owned = [
    paths.bin,
    paths.repo,
    `${paths.repo}.partial`,
    paths.downloads,
    paths.freedoom1,
    paths.freedoom2,
    `${paths.dir}/${FREEDOOM_COPYING}`,
    paths.shareware,
    // The game's own leavings: a save directory on every start, the cfg files
    // when it is quit from its menu.
    `${paths.dir}/.savegame`,
    `${paths.dir}/default.cfg`,
    `${paths.dir}/doom.cfg`,
  ]
  const removed: string[] = []
  for (const path of owned) {
    if (!(await files.exists(path))) continue
    await run(['rm', '-rf', path])
    removed.push(path.slice(paths.dir.length + 1))
  }

  if (!(await files.exists(paths.dir))) return { removed, kept: [] }
  const listing = await run(['ls', '-A', paths.dir])
  const kept = listing.stdout.split('\n').filter(Boolean)
  if (kept.length === 0) await run(['rmdir', paths.dir])
  return { removed, kept }
}

/** Starts the game in a fresh detached session; resolves an error, or nothing. */
export async function start(run: Run, session: string, paths: Paths, wad: string): Promise<string | undefined> {
  await stop(run, session)
  const result = await run([
    ...TMUX,
    'new-session', '-d', '-s', session,
    // The game's own directory, never the session's: doomgeneric writes
    // `.savegame/` and its cfg files relative to the cwd it inherits, which
    // would otherwise be whatever repository Claude Code was started in.
    '-c', paths.dir,
    '-x', String(GRID.columns), '-y', String(WINDOW_ROWS),
    paths.bin, '-iwad', wad, '-charset', 'quadrant', '-color', '24bit', '-columns', String(GRID.columns),
  ])
  return result.exitCode === 0 ? undefined : result.stderr.trim() || `tmux exited ${result.exitCode}`
}

/**
 * The visible frame as text with its colour escapes, or nothing once the game
 * is gone. `-N` keeps each row's trailing spaces: without it tmux trims them,
 * coloured or not, and a row ending in one flat colour comes back short.
 *
 * A failure carries tmux's own words: the game ending and a tmux too old for
 * `-N` both stop the frames, and only the second says so.
 */
export async function capture(run: Run, session: string): Promise<{ frame?: string; error?: string }> {
  const result = await run([...TMUX, 'capture-pane', '-t', session, '-p', '-e', '-N', '-S', '0', '-E', String(GRID.rows - 1)])
  if (result.exitCode === 0) return { frame: result.stdout }
  return { error: result.stderr.trim() || `capture-pane exited ${result.exitCode}` }
}

export async function sendKeys(run: Run, session: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  const result = await run([...TMUX, 'send-keys', '-t', session, ...keys])
  if (result.exitCode !== 0) throw new Error(`send-keys exited ${result.exitCode}: ${result.stderr.trim()}`)
}

export function isRunning(run: Run, session: string): Promise<boolean> {
  return succeeds(run, [...TMUX, 'has-session', '-t', session])
}

export async function stop(run: Run, session: string): Promise<void> {
  await succeeds(run, [...TMUX, 'kill-session', '-t', session])
}
