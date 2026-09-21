/**
 * Maps a key a `Client` heard to the key name `tmux send-keys` takes.
 */

export type KeyPress = { key: string; ctrl?: boolean }

const NAMED: Readonly<Record<string, string>> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'BSpace',
  delete: 'DC',
  space: 'Space',
  ' ': 'Space',
  pageup: 'PPage',
  pagedown: 'NPage',
  home: 'Home',
  end: 'End',
}

// doom-cli reads a terminal, which reports no Ctrl-as-a-key, so fire is Z
// there. F fires too, as it did in the widget this mod replaces.
const FIRE = new Set(['f', 'F', 'z', 'Z'])

// Escape never reaches a Client: it hands the keyboard back to the prompt.
// Backtick stands in for Doom's own Escape, which opens the menu.
const MENU = '`'

export function tmuxKeyOf(press: KeyPress): string | undefined {
  const named = NAMED[press.key]
  if (named) return press.ctrl ? `C-${named}` : named
  if (press.key === MENU) return 'Escape'
  if (FIRE.has(press.key)) return 'Z'
  // tmux reads a lone `;` argument as its own command separator.
  if ([...press.key].length !== 1 || press.key === ';') return undefined
  return press.ctrl ? `C-${press.key}` : press.key
}

/**
 * The keys a focused pane can press without a click: a Button's `hotkey` is
 * one lowercase letter or digit, and the arrows scroll the pane rather than
 * reach it, so movement sits on WASD.
 */
export type Hotkey = { hotkey: string; label: string; tmux: string }

export const ACTION_HOTKEYS: readonly Hotkey[] = [
  { hotkey: 'w', label: '↑', tmux: 'Up' },
  { hotkey: 'a', label: '←', tmux: 'Left' },
  { hotkey: 's', label: '↓', tmux: 'Down' },
  { hotkey: 'd', label: '→', tmux: 'Right' },
  { hotkey: 'f', label: 'fire', tmux: 'Z' },
  { hotkey: 'e', label: 'use', tmux: 'Space' },
  { hotkey: 'r', label: 'enter', tmux: 'Enter' },
  { hotkey: 'q', label: 'menu', tmux: 'Escape' },
  { hotkey: 'y', label: 'yes', tmux: 'y' },
]

export const WEAPON_HOTKEYS: readonly Hotkey[] = ['fist', 'pistol', 'shotgun', 'chain', 'rocket', 'plasma', 'bfg'].map(
  (label, index) => ({ hotkey: String(index + 1), label, tmux: String(index + 1) }),
)

/** Reads what the controls strip posted; anything malformed is dropped. */
export function pressesOf(data: unknown): KeyPress[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const { key, ctrl } = item as { key?: unknown; ctrl?: unknown }
    return typeof key === 'string' ? [{ key, ctrl: ctrl === true }] : []
  })
}
