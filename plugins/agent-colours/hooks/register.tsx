import type { EngineInterface, Register } from 'claude-code'
import { parseAgent, pluginInstalls } from './agents'
import { badgeFor, mentionPattern } from './colours'
import { splitReply } from './mentions'

const AGENT_TOOLS = new Set(['Agent', 'Task'])

type AgentInput = { subagent_type?: unknown; description?: unknown }

// One coloured space each side, so a badge reads as a chip, not a tight highlight.
const pad = (name: string) => ` ${name} `

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

// Reads every `color:` field in one agents folder into `into`, keyed `<prefix><name>`.
// False when the folder does not exist.
async function readAgentsDir($: EngineInterface, dir: string, prefix: string, into: Map<string, string>) {
  const entries = await $.fs.list(dir).catch(() => undefined)
  if (!entries) return false
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const body = await $.fs.read(`${dir}/${entry.name}`).catch(() => undefined)
    if (typeof body !== 'string') continue
    const agent = parseAgent(body, entry.name)
    if (agent.color) into.set(`${prefix}${agent.name}`, agent.color)
  }
  return true
}

// Each agent type's `color:` field, keyed as the Agent tool names the type:
// `plugin:name` for a plugin's agent, the bare name for a user or project agent.
// No engine API lists agent files, so they are found where Claude Code finds them.
async function loadAgentColours($: EngineInterface) {
  const colours = new Map<string, string>()
  const home = await $.env.get('HOME')
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  if (configDir) {
    const raw = await $.fs.read(`${configDir}/plugins/installed_plugins.json`).catch(() => undefined)
    for (const [plugin, rows] of pluginInstalls(raw)) {
      for (const row of rows) {
        if (typeof row.installPath !== 'string') continue
        if (await readAgentsDir($, `${row.installPath}/agents`, `${plugin}:`, colours)) break
      }
    }
    await readAgentsDir($, `${configDir}/agents`, '', colours)
  }
  // The project's own agents win over the user's, as they do in Claude Code.
  await readAgentsDir($, '.claude/agents', '', colours)
  return colours
}

// Drawing caches only: a hot reload empties them, and the next draw refills them.
// The agent files are read once per load, so an edited `color:` shows after a reload.
const seenTypes = new Set<string>()
let colours: Promise<Map<string, string>> | undefined

function agentColours($: EngineInterface) {
  colours ??= loadAgentColours($).catch(() => new Map<string, string>())
  return colours
}

export const register: Register = on => {
  colours = undefined

  // The Agent call's header line, `● dev:architect(Plan the cache)`, redrawn as the
  // engine draws it with one change: the agent name sits on its `color:` badge.
  // The result block under it is a separate component and stays the engine's.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!AGENT_TOOLS.has(e.props.tool)) return next(e)
    const input = (e.props.input ?? {}) as AgentInput
    const type = text(input.subagent_type)
    if (type) seenTypes.add(type)
    // The engine names a general-purpose call plain `Agent`.
    const name = !type || type === 'general-purpose' ? 'Agent' : type
    const description = text(input.description)
    const dot = e.props.isErrored ? 'error' : e.props.isRunning ? undefined : 'success'
    const badge = badgeFor(type, await agentColours($))
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text color={dot} dimColor={dot === undefined}>● </Text>
        <Text bold backgroundColor={badge.bg} color={badge.fg}>{pad(name)}</Text>
        {description && <Text>({description})</Text>}
      </Box>
    )
  })

  // Every reply, as the email example does: a paragraph that names an agent is
  // drawn by the mod with the name on its badge; the rest stays the engine's markdown.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const known = await agentColours($)
    const agents = await $.agent.list().catch(() => [])
    for (const a of agents) seenTypes.add(a.type)
    const blocks = splitReply(e.props.text, mentionPattern([...known.keys(), ...seenTypes]))
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
                    const badge = span.agent ? badgeFor(span.agent, known) : undefined
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
