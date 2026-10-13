# agent-colours

A Claude Code mod that draws each subagent's name on a coloured badge, so you can tell
agents apart at a glance:

- **The Agent row.** `● dev:architect(Plan the cache)`: the name sits on its badge, and
  the rest of the row is as Claude Code draws it.
- **Every reply.** Wherever a reply names an agent, the name gets the same badge.

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
  the spinner line and the "Message from …" label keep Claude Code's own look.

## Developing it

```bash
claude plugin validate plugins/agent-colours
claude plugin test plugins/agent-colours
```

`tsc -p plugins/agent-colours` works once Claude Code has loaded the mod, which writes
`.claude-plugin/types/` beside it (git-ignored).
