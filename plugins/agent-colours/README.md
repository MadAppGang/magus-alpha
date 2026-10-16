# agent-colours

A Claude Code mod that colours subagent and skill names by their own `color:` field, so
you can tell them apart at a glance. An agent's name sits on a coloured badge; a skill's
name is drawn in its colour, with no badge:

- **The Agent row.** `● dev:architect(Plan the cache)`: the name sits on its badge, and
  the rest of the row is as Claude Code draws it.
- **The Skill row.** `● Skill(dev:dev)`: the skill name is drawn in its colour.
- **Every reply.** Wherever a reply names an agent, the name gets the same badge; a
  coloured skill named in a reply is drawn in its colour.

## Where the colour comes from

The agent's own `color:` field, the same frontmatter field Claude Code's `/agents` list
reads:

```markdown
---
name: code-improver
description: Scans files and suggests improvements.
color: green
---
```

A value is one of `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`,
or a hex colour such as `"#FFD700"`. The text on a hex badge is black or white, whichever
reads on it.

The mod finds agent files where Claude Code does: each installed plugin's `agents/`
folder, `~/.claude/agents/`, and the project's `.claude/agents/`. A project agent wins
over a user agent of the same name.

- **The built-in agents** (`Explore`, `Plan`, `general-purpose`) have no file, so the mod
  gives them fixed colours.
- **An agent with no `color:` field** still gets a badge: a colour picked from its name,
  the same one every time.

The files are read once each time the mod loads, so an edited `color:` shows after a
new session or `/reload-plugins`.

## Skills

A skill or command opts in with the same `color:` field in its frontmatter:

```markdown
---
name: release
description: Cuts a release.
color: green
---
```

The values are the agent ones, a colour name or a `#RRGGBB` hex colour, drawn as text
colour only. A skill with no `color:` field, or with a value that is not a colour
(`teal`, `#FFF`), keeps Claude Code's look: there is no colour picked from its name.

The mod finds skills and commands where Claude Code does, each later place overriding the
ones before it:

1. each installed plugin's `commands/*.md`, `skills/<name>/SKILL.md`, and the skill paths
   its `.claude-plugin/plugin.json` lists, keyed `plugin:name` (a plugin's skill wins over
   its command of the same name; the newest install whose folder exists is read)
2. `~/.claude/commands/*.md`, then `~/.claude/skills/<name>/SKILL.md`, symbolic links included
3. the project's `.claude/commands/*.md`, then `.claude/skills/<name>/SKILL.md`

The highest definition of a name decides alone: a project skill with no `color:` leaves the
name uncoloured, even when the user's skill of that name has one.

In a reply, a skill is coloured only where it reads as a skill: `plugin:name`, or `/name`
for any skill, the slash coloured with it. A bare word (`commit`) never is, nor a `/name`
inside a path or URL (`src/commit`, `https://x.dev/commit`) or running on into a longer
word (`/commits`, `/commit.md`). A name that is also an agent keeps its agent badge.

## Install

Run `magus`, add the `magus-alpha` marketplace, and install `agent-colours@magus-alpha`
from the Plugins tab. Or, in Claude Code:

```
/plugin marketplace add MadAppGang/magus-alpha
/plugin install agent-colours@magus-alpha
```

## Limits

- **Only the name in a reply paragraph is restyled, but the paragraph is redrawn.** A
  mod cannot colour one word inside a paragraph Claude Code draws, so a paragraph that
  names an agent is drawn by the mod. It keeps bold, inline code and headings. Links,
  italics and list bullets in that one paragraph show as plain text. Other paragraphs and
  code blocks are untouched.
- **`Explore` and `Plan` are coloured wherever they appear capitalised.** Lowercase "plan"
  never is.
- **Some places have no hook.** The agents panel under the prompt, the `/agents` list,
  the spinner line and the "Message from …" label keep Claude Code's own look. So do
  skills in a collapsed tool group, the `/skills` list and the slash-command typeahead.
- **The typed `/skill` prompt row is not coloured.** A hook can only rewrite that row's
  text, which carries no colour, or redraw the whole prompt row itself.
- **Commands in subfolders** (`commands/a/b.md`, invoked as `a:b`) are not coloured.
- **A skill name right beside bold or code markers is judged on the run it sits in.** Each
  bold, code and plain run of a paragraph is matched on its own, so the characters on the
  far side of a marker do not count. `` `a`/commit `` and `x**/commit**` colour `/commit`,
  and `**/commit**s` colours the `/commit` of what reads as `/commits`. Plain text has no
  such edge.

## Developing it

```bash
claude plugin validate plugins/agent-colours
claude plugin test plugins/agent-colours
```

`tsc -p plugins/agent-colours` works once Claude Code has loaded the mod, which writes
`.claude-plugin/types/` beside it (git-ignored).
