# Changelog

> Filtered view. This lists only the plugins published to the `magus-alpha` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## [claudoom 0.1.0] - 2026-09-22

### Added

- **`/claudoom` plays a Doom-engine WAD in a pane beside the conversation, at about 30
  frames a second.** It is this marketplace's first Claude Code *mod*: a plugin whose
  behaviour is a function-hooks module rather than commands and skills, so it needs
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and does nothing without it. doom-cli runs in a
  tmux server of the plugin's own, `capture-pane` reads each frame, and the frame is
  repainted into a terminal `Raster` with `$.ui.blit`. The picture scales to whatever
  room the pane has, so it fits a narrow inline block and a full-height dock alike, and
  a torn capture is dropped rather than drawn: doom-cli clears the screen at the top of
  every frame, and tmux applies the ~60 KB that follows in chunks.
- **Playing from the keyboard, within what a pane is allowed.** A focused pane keeps the
  arrow keys for scrolling and never hands a `Client` the keyboard without a click, so
  movement sits on a row of `Button` hotkeys (WASD, F fire, E use, R enter, Q menu, 1-7
  weapons), ↑ and ↓ are recovered from the `ui.scroll` events the arrows raise, and the
  focus ring starts on the enter button so Enter selects in Doom's menus.
- **Nothing is bundled, and every download is verified before it is built, kept or run.**
  `/claudoom install` builds doom-cli (GPLv2) from the tarball of one pinned commit —
  never through `git`, so a config that rewrites GitHub URLs to SSH cannot break it — and
  checks it against a pinned digest of the extracted source tree, which a forge
  re-compressing the same commit cannot break and a changed file cannot pass. The source
  is unpacked into a staging directory and moved into place only once it verifies, so an
  interrupted install leaves nothing that a later run mistakes for the source. Freedoom
  (BSD) comes from its official release, verified against the SHA-256 in its signed
  checksum file.
  id's shareware episode stays opt-in: `/claudoom install shareware` prints the terms from
  id's own LICENSE.DOC, and only `accept` fetches id's compressed archive, checking both
  the archive and the WAD. `/claudoom uninstall` removes what the install wrote and leaves
  anything else in the folder alone.

---

## [magus-alpha 0.6.0] - 2026-09-12

### Removed

- **BREAKING — `autolinear` is gone from `magus-alpha`.** The channel itself stays for
  upcoming alpha plugins, and publishes an empty marketplace until the next one lands.

### Migration notes

Remove `autolinear@magus-alpha` from `enabledPlugins`. Keep the `magus-alpha` marketplace
registered: new alpha plugins will ship there.
