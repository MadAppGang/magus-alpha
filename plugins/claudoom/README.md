# claudoom

Plays Doom-engine WADs in a Claude Code pane. It is a Claude Code **mod**: a
plugin whose behaviour lives in a function-hooks module (`hooks/register.tsx`).
It runs [doom-cli](https://github.com/ludocode/doom-cli) in a private tmux
server, reads each frame with `tmux capture-pane`, and repaints it into a
terminal `Raster`, scaled to fit the pane.

Function hooks are early access and off by default. Start Claude Code with the
flag and the plugin folder:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/claudoom
```

## Commands

| Command | Does |
|---|---|
| `/claudoom install` | Builds doom-cli and downloads Freedoom |
| `/claudoom install shareware` | Shows the shareware licence terms; add `accept` to download |
| `/claudoom` | Plays the shareware episode if installed, else Freedoom; again closes it |
| `/claudoom freedoom2` | Plays Freedoom Phase 2 |
| `/claudoom <file.wad>` | Plays a WAD you own |
| `/claudoom stop` | Stops the game |
| `/claudoom uninstall` | Stops the game and removes what the install wrote; files you added yourself stay |

While the pane holds the keys: WASD or ↑↓ move, F fire, E use, Enter or R
select, Q menu, 1–7 weapons. Esc hands the keys back to the prompt; ctrl+x tab
takes them again. It needs `tmux`, `make`, `curl`, `tar`, `unzip` and `shasum`.
It never runs `git`, so a git config that rewrites GitHub URLs to SSH cannot
break the install.

## What is downloaded, and under which licence

Nothing below ships with this plugin. `/claudoom install` fetches it onto your
machine, into `~/.claude/claudoom`, over HTTPS only (a redirect to plain http is
refused), and verifies each download against a pinned digest before anything is
built, kept or run.

The engine's digest covers the **extracted source tree**, not the tarball, so a
forge re-compressing the same commit does not break the install while a changed
file still does. The command that recomputes it is in `hooks/doom.ts`, beside
the digest.

| Component | Licence | Source |
|---|---|---|
| doom-cli, a doomgeneric port | GPLv2 | fetched from upstream at a pinned commit, verified against a pinned source-tree digest, then built locally; the mod talks to it only through tmux |
| Freedoom 0.13.0 | 3-clause BSD, notice kept as `freedoom-COPYING.txt` | the official GitHub release, checked against its signed SHA-256 |
| DOOM1.WAD, the shareware episode (opt-in) | id Software's shareware licence: not free software, no commercial use | id's own `doom19s.zip` from /idgames, archive and WAD both checked |

The shareware licence (`LICENSE.DOC`, shipped with id's v1.8 shareware) allows
electronic distribution royalty free and "only in compressed format", and
forbids modifying the WAD (§1), commercial use (§2) and charging anyone for it
without id's prior written consent (§4). That is why the shareware download is
opt-in, shows those terms first, and fetches id's compressed archive rather
than a bare WAD.

DOOM is a trademark of the ZeniMax group of companies. Claude is a trademark of
Anthropic. This plugin is not affiliated with or endorsed by id Software,
ZeniMax or Anthropic. This is not legal advice.
