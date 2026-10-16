# Changelog

> Filtered view. This lists only the plugins published to the `magus-alpha` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## [agent-colours 0.2.0] - 2026-10-16

### Added

- **A skill's name is drawn in the colour of its own `color:` field, in its Skill row and in
  replies.** Text colour only, no badge. The values are the agent ones: a colour name or a
  hex colour such as `"#FFD700"`. A skill with no valid `color:` keeps Claude Code's look.
- Skills and commands are read where Claude Code finds them: each installed plugin's
  `commands/`, `skills/` and the skill paths its manifest lists, then `~/.claude/commands/`,
  `~/.claude/skills/` (symbolic links included), `.claude/commands/` and `.claude/skills/`.
  The highest definition of a name decides alone, so a project skill with no `color:`
  leaves that name uncoloured even when the user's has one.
- In a reply, a skill is coloured only as `plugin:name` or `/name`, never as a bare word or
  inside a path or URL. A name that is also an agent keeps its agent badge.

### Known limits

- The typed `/skill` prompt row, subfolder commands (`a:b`), collapsed tool groups, the
  `/skills` list and the slash-command typeahead keep Claude Code's look.
- A `/name` right beside bold or inline-code markers is judged on the run it sits in, not
  on the characters past the marker, so it can colour where plain text would not.

---

## [agent-colours 0.1.0] - 2026-10-13

### Added

- **Each subagent's name sits on a coloured badge, in its Agent row and in every reply that
  names it.** The colour is the agent file's own `color:` field, read from each installed
  plugin's `agents/` folder, `~/.claude/agents/` and the project's `.claude/agents/`. A
  value is one of Claude Code's colour names (`red`, `blue`, `green`, `yellow`, `purple`,
  `orange`, `pink`, `cyan`) or a hex colour such as `"#FFD700"`.
- `Explore`, `Plan` and `general-purpose` have no agent file, so they get fixed colours. An
  agent with no `color:` field gets a colour picked from its name, the same one every time.
- A function-hooks mod: it draws, and adds no commands, skills or agents. It loaded on
  Claude Code 2.1.296 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` unset.

### Known limits

- A reply paragraph that names an agent is drawn by the mod, so it keeps bold, inline code
  and headings only; links, italics and list bullets in that paragraph show as plain text.
  Other paragraphs and code blocks are Claude Code's own.
- The agents panel under the prompt, the `/agents` list, the spinner and the "Message from
  …" label have no hook a mod can draw, and keep Claude Code's look.

---

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
