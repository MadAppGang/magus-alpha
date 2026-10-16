import type { EngineInterface, Register } from 'claude-code'
import { parseAgent, pluginInstalls } from './agents'
import type { Row } from './agents'
import { badgeFor, mentionPattern, textColourFromField } from './colours'
import { splitReply } from './mentions'
import { manifestSkillPaths, parseSkill, skillKey } from './skills'
import type { SkillDef } from './skills'

const AGENT_TOOLS = new Set(['Agent', 'Task'])

type AgentInput = { subagent_type?: unknown; description?: unknown }

// One coloured space each side, so a badge reads as a chip, not a tight highlight.
const pad = (name: string) => ` ${name} `

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

// Where Claude Code keeps the user's own files: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
async function userConfigDir($: EngineInterface) {
  const home = await $.env.get('HOME')
  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
}

// Reads every `color:` field in one agents folder into `into`, keyed `<prefix><name>`,
// and every agent's name, coloured or not, into `names`.
// False when the folder does not exist.
async function readAgentsDir(
  $: EngineInterface,
  dir: string,
  prefix: string,
  into: Map<string, string>,
  names: Set<string>,
) {
  const entries = await $.fs.list(dir).catch(() => undefined)
  if (!entries) return false
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const body = await $.fs.read(`${dir}/${entry.name}`).catch(() => undefined)
    if (typeof body !== 'string') continue
    const agent = parseAgent(body, entry.name)
    names.add(`${prefix}${agent.name}`)
    if (agent.color) into.set(`${prefix}${agent.name}`, agent.color)
  }
  return true
}

type Agents = { colours: Map<string, string>; names: Set<string> }

// Each agent type's `color:` field, keyed as the Agent tool names the type:
// `plugin:name` for a plugin's agent, the bare name for a user or project agent.
// No engine API lists agent files, so they are found where Claude Code finds them.
// `names` holds every agent file's name, so a reply never draws an agent as a skill.
async function loadAgentColours($: EngineInterface): Promise<Agents> {
  const colours = new Map<string, string>()
  const names = new Set<string>()
  const configDir = await userConfigDir($)
  if (configDir) {
    const raw = await $.fs.read(`${configDir}/plugins/installed_plugins.json`).catch(() => undefined)
    for (const [plugin, rows] of pluginInstalls(raw)) {
      for (const row of rows) {
        if (typeof row.installPath !== 'string') continue
        if (await readAgentsDir($, `${row.installPath}/agents`, `${plugin}:`, colours, names)) break
      }
    }
    await readAgentsDir($, `${configDir}/agents`, '', colours, names)
  }
  // The project's own agents win over the user's, as they do in Claude Code.
  await readAgentsDir($, '.claude/agents', '', colours, names)
  return { colours, names }
}

// A skill definition replaces whatever a lower one said about its key: a coloured one
// sets the key's text colour, any other removes it. Only a valid colour is ever stored.
type Apply = (prefix: string, def: SkillDef) => void

const applyTo =
  (into: Map<string, string>): Apply =>
  (prefix, def) => {
    const key = `${prefix}${def.name}`
    const colour = def.color ? textColourFromField(def.color) : undefined
    if (colour) into.set(key, colour)
    else into.delete(key)
  }

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1)

// One skill folder: its SKILL.md, named by `fallbackName` when it has no `name:`.
// False when there is no SKILL.md to read.
async function readSkillDir($: EngineInterface, dir: string, fallbackName: string, prefix: string, apply: Apply) {
  const body = await $.fs.read(`${dir}/SKILL.md`).catch(() => undefined)
  if (typeof body !== 'string') return false
  apply(prefix, parseSkill(body, fallbackName))
  return true
}

// A folder of skill folders. Any entry but a plain file is tried, since a symbolic
// link to a skill folder lists as `other`; a failed read is the filter.
async function readSkillsContainer($: EngineInterface, dir: string, prefix: string, apply: Apply) {
  const entries = await $.fs.list(dir).catch(() => undefined)
  for (const entry of entries ?? []) {
    if (entry.kind === 'file') continue
    await readSkillDir($, `${dir}/${entry.name}`, entry.name, prefix, apply)
  }
}

// A commands folder: each `.md` file directly in it is one command. Subfolders are not read.
async function readCommandsDir($: EngineInterface, dir: string, prefix: string, apply: Apply) {
  const entries = await $.fs.list(dir).catch(() => undefined)
  for (const entry of entries ?? []) {
    if (entry.kind === 'dir' || !entry.name.endsWith('.md')) continue
    const body = await $.fs.read(`${dir}/${entry.name}`).catch(() => undefined)
    if (typeof body === 'string') apply(prefix, parseSkill(body, entry.name))
  }
}

// One plugin's commands and skills, keyed `plugin:name`: commands first, then the
// auto-scanned `skills/`, then any path its manifest lists.
async function readPluginSkills($: EngineInterface, plugin: string, root: string) {
  const found = new Map<string, string>()
  const apply = applyTo(found)
  const prefix = `${plugin}:`
  await readCommandsDir($, `${root}/commands`, prefix, apply)
  await readSkillsContainer($, `${root}/skills`, prefix, apply)
  const manifest = await $.fs.read(`${root}/.claude-plugin/plugin.json`).catch(() => undefined)
  for (const path of manifestSkillPaths(manifest)) {
    const dir = path === '.' ? root : `${root}/${path}`
    const fallback = path === '.' ? plugin : lastSegment(path)
    if (!(await readSkillDir($, dir, fallback, prefix, apply))) await readSkillsContainer($, dir, prefix, apply)
  }
  return found
}

// Each plugin's install rows across every marketplace, newest first, in registry order:
// one plugin name is read from one install, whichever marketplace it came from.
const rowsByPlugin = (raw: unknown): [plugin: string, rows: Row[]][] => {
  const grouped = new Map<string, Row[]>()
  for (const [plugin, rows] of pluginInstalls(raw)) grouped.set(plugin, [...(grouped.get(plugin) ?? []), ...rows])
  return [...grouped].map(([plugin, rows]) => [
    plugin,
    rows.sort((a, b) => String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? ''))),
  ])
}

// The newest install whose directory still exists speaks for its plugin.
async function installRoot($: EngineInterface, rows: Row[]) {
  for (const row of rows) {
    if (typeof row.installPath !== 'string') continue
    if (await $.fs.list(row.installPath).then(() => true, () => false)) return row.installPath
  }
  return undefined
}

// Each coloured skill key's text colour, found where Claude Code finds skills and
// commands. Lowest to highest: plugins, user commands, user skills, project commands,
// project skills; the highest definition of a key decides alone.
async function loadSkillColours($: EngineInterface) {
  const colours = new Map<string, string>()
  const apply = applyTo(colours)
  const configDir = await userConfigDir($)
  if (configDir) {
    const raw = await $.fs.read(`${configDir}/plugins/installed_plugins.json`).catch(() => undefined)
    // Plugins are walked in parallel for a quicker first draw, then merged in a fixed
    // order, so the result never depends on which read finished first.
    const plugins = await Promise.all(
      rowsByPlugin(raw).map(async ([plugin, rows]) => {
        const root = await installRoot($, rows)
        return root ? readPluginSkills($, plugin, root).catch(() => new Map<string, string>()) : new Map<string, string>()
      }),
    )
    for (const found of plugins) for (const [key, colour] of found) colours.set(key, colour)
    await readCommandsDir($, `${configDir}/commands`, '', apply)
    await readSkillsContainer($, `${configDir}/skills`, '', apply)
  }
  await readCommandsDir($, '.claude/commands', '', apply)
  await readSkillsContainer($, '.claude/skills', '', apply)
  return colours
}

// Drawing caches only: a hot reload empties them, and the next draw refills them.
// The agent and skill files are read once per load, so an edited `color:` shows after a reload.
const seenTypes = new Set<string>()
let agents: Promise<Agents> | undefined
let skills: Promise<Map<string, string>> | undefined

function agentColours($: EngineInterface) {
  agents ??= loadAgentColours($).catch(() => ({ colours: new Map<string, string>(), names: new Set<string>() }))
  return agents
}

function skillColours($: EngineInterface) {
  skills ??= loadSkillColours($).catch(() => new Map<string, string>())
  return skills
}

export const register: Register = on => {
  agents = undefined
  skills = undefined

  // The call's header line, redrawn as the engine draws it with one change. An Agent
  // call, `● dev:architect(Plan the cache)`, puts the agent name on its `color:` badge;
  // a Skill call, `● Skill(dev:dev)`, draws the skill name in its `color:`.
  // The result block under it is a separate component and stays the engine's.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const dot = e.props.isErrored ? 'error' : e.props.isRunning ? undefined : 'success'
    if (e.props.tool === 'Skill') {
      const key = skillKey(e.props.input)
      if (!key || e.props.isInterrupted) return next(e)
      // The skill's own colour only: an agent of the same name never lends its badge.
      const colour = (await skillColours($)).get(key)
      if (!colour) return next(e)
      const shown = String((e.props.input as { skill: string }).skill).trim()
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="row">
          <Text color={dot} dimColor={dot === undefined}>● </Text>
          <Text bold>Skill</Text>
          <Text>(</Text>
          <Text color={colour}>{shown}</Text>
          <Text>)</Text>
        </Box>
      )
    }
    if (!AGENT_TOOLS.has(e.props.tool)) return next(e)
    const input = (e.props.input ?? {}) as AgentInput
    const type = text(input.subagent_type)
    if (type) seenTypes.add(type)
    // The engine names a general-purpose call plain `Agent`.
    const name = !type || type === 'general-purpose' ? 'Agent' : type
    const description = text(input.description)
    const badge = badgeFor(type, (await agentColours($)).colours)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text color={dot} dimColor={dot === undefined}>● </Text>
        <Text bold backgroundColor={badge.bg} color={badge.fg}>{pad(name)}</Text>
        {description && <Text>({description})</Text>}
      </Box>
    )
  })

  // Every reply, as the email example does: a paragraph that names an agent or a
  // coloured skill is drawn by the mod, the agent on its badge and the skill in its
  // colour; the rest stays the engine's markdown.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const [{ colours: known, names }, skillColour] = await Promise.all([agentColours($), skillColours($)])
    const running = await $.agent.list().catch(() => [])
    for (const a of running) seenTypes.add(a.type)
    const pattern = mentionPattern([...known.keys(), ...seenTypes], skillColour.keys(), names)
    const blocks = splitReply(e.props.text, pattern)
    if (!blocks) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {blocks.map((block, b) =>
          block.kind === 'markdown' ? (
            <Markdown key={`m${b}`} text={block.text} />
          ) : (
            <Box key={`s${b}`} flexDirection="column">
              {block.lines.map((line, l) => (
                <Text key={`l${l}`}>
                  {line.map((span, i) => {
                    const skill = span.mention?.kind === 'skill' ? skillColour.get(span.mention.name) : undefined
                    if (skill) {
                      // Text colour only: no background, no padding; it replaces a code span's colour.
                      return (
                        <Text key={`t${i}`} bold={span.bold || false} color={skill}>
                          {span.text}
                        </Text>
                      )
                    }
                    const badge = span.mention?.kind === 'agent' ? badgeFor(span.mention.name, known) : undefined
                    return (
                      <Text
                        key={`t${i}`}
                        bold={span.bold || badge !== undefined}
                        color={badge?.fg ?? (span.code ? 'permission' : undefined)}
                        backgroundColor={badge?.bg}
                      >
                        {badge ? pad(span.text) : span.text}
                      </Text>
                    )
                  })}
                </Text>
              ))}
            </Box>
          ),
        )}
      </Box>
    )
  })
}
