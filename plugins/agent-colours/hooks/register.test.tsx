import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { badgeFromField } from './colours'

type On = Parameters<TestBody>[1]

// A machine with one installed plugin, `dev`, at two install paths: the newer one
// carries `color:` fields; plus a project agent that sets its colour in hex.
const FILES: Record<string, string> = {
  '/home/u/.claude/plugins/installed_plugins.json': JSON.stringify({
    version: 2,
    plugins: {
      'dev@magus': [
        { installPath: '/cache/dev/1.0.0', lastUpdated: '2026-01-01T00:00:00Z' },
        { installPath: '/cache/dev/2.0.0', lastUpdated: '2026-09-01T00:00:00Z' },
      ],
    },
  }),
  '/cache/dev/1.0.0/agents/architect.md': '---\nname: architect\ncolor: red\n---\nold',
  '/cache/dev/2.0.0/agents/architect.md': '---\nname: architect\ndescription: Plans.\ncolor: blue\n---\nbody',
  '/cache/dev/2.0.0/agents/developer.md': '---\nname: developer\ncolor: "green"\n---\nbody',
  '/cache/dev/2.0.0/agents/scribe.md': '---\nname: scribe\n---\nno colour field',
  '.claude/agents/code-improver.md': '---\nname: code-improver\ntools: Read\ncolor: "#FFD700"\n---\nbody',
}

// A relative key is the project's: it matches the absolute path the engine resolves it to.
const samePath = (key: string, path: string) => key === path || (!key.startsWith('/') && path.endsWith(`/${key}`))
const resolve = (path: string) => Object.keys(FILES).find(k => samePath(k, path)) ?? path

const entries = (dir: string) =>
  Object.keys(FILES)
    .filter(k => samePath(k.slice(0, k.lastIndexOf('/')), dir))
    .map(k => ({ name: k.slice(k.lastIndexOf('/') + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }))

// Stands in for the engine and the machine beneath the plugin.
const machine = (on: On) => {
  on('ui.render', () => ({ type: 'engine' as const, ref: 0 }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', ($, e) => {
    const text = FILES[resolve(e.path)]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', ($, e) => {
    const found = entries(e.path)
    return found.length ? { value: found } : { deny: `ENOENT ${e.path}` }
  })
  on('agent.list', () => ({ value: [] }))
}

const toolUse = (input: unknown, tool = 'Agent') => ({
  component: 'ToolUse' as const,
  props: { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: false, isInterrupted: false },
})

const reply = (text: string) => ({ component: 'AssistantMessage' as const, props: { text, isFirstOfReply: true } })

// `find` matches text as a substring, so the line holding a name matches first:
// pick the span whose whole text is the name, a badge's with its padding.
type Drawing = { findAll: (q: { type: 'Text'; text: string }) => Promise<ReadonlyArray<{ text?: string; props?: unknown }>> }
const span = async (ui: Drawing, name: string) =>
  (await ui.findAll({ type: 'Text', text: name })).find(t => t.text === name || t.text === ` ${name} `)

test('a badge has one space of padding each side; the text around it does not', async ($, on) => {
  machine(on)
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...toolUse({ subagent_type: 'Plan', description: 'Plan it', prompt: 'x' }) })
  expect((await span(ui, 'Plan'))?.text).toBe(' Plan ')
  expect((await span(ui, 'Plan'))?.props).toMatchObject(bg('green'))
  expect((await span(ui, '(Plan it)'))?.text).toBe('(Plan it)')
  await ui.unmount()
})

const bg = (color: string) => ({ backgroundColor: badgeFromField(color)?.bg })

test("an Agent row's name takes its agent's color: field, from the newest install", async ($, on) => {
  machine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-colours', surface, ...toolUse({ subagent_type: 'dev:architect', description: 'Plan it', prompt: 'x' }) })
    expect((await span(ui, 'dev:architect'))?.props).toMatchObject(bg('blue'))
    expect((await span(ui, '(Plan it)'))?.props).not.toHaveProperty('backgroundColor')
    await ui.unmount()
  }
})

test('a quoted color: value and a project agent with a hex colour both work', async ($, on) => {
  machine(on)
  const dev = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...toolUse({ subagent_type: 'dev:developer', prompt: 'x' }) })
  expect((await span(dev, 'dev:developer'))?.props).toMatchObject(bg('green'))
  await dev.unmount()
  const own = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...toolUse({ subagent_type: 'code-improver', prompt: 'x' }) })
  // #FFD700 is bright, so its text is black.
  expect((await span(own, 'code-improver'))?.props).toMatchObject({ backgroundColor: '#FFD700', color: '#000000' })
  await own.unmount()
})

test('an agent with no color: field still gets a badge', async ($, on) => {
  machine(on)
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...toolUse({ subagent_type: 'dev:scribe', prompt: 'x' }) })
  expect((await span(ui, 'dev:scribe'))?.props).toHaveProperty('backgroundColor')
  await ui.unmount()
})

test('a general-purpose call is named Agent, as the engine names it', async ($, on) => {
  machine(on)
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...toolUse({ description: 'Count', prompt: 'x' }) })
  expect((await span(ui, 'Agent'))?.props).toHaveProperty('backgroundColor')
  await ui.unmount()
})

test('a non-agent tool row is left to the engine', async ($, on) => {
  machine(on)
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...toolUse({ command: 'ls' }, 'Bash') })
  expect(await ui.drawn()).not.toMatchObject({ type: 'Box' })
  await ui.unmount()
})

test('a reply names agents on their color: badges and keeps other paragraphs as markdown', async ($, on) => {
  machine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-colours', surface, ...reply('**Explore** found it; dev:architect and code-improver agree.\n\nNothing else to say.') })
    expect((await span(ui, 'dev:architect'))?.props).toMatchObject(bg('blue'))
    expect((await span(ui, 'code-improver'))?.props).toMatchObject({ backgroundColor: '#FFD700' })
    expect((await span(ui, 'Explore'))?.props).toHaveProperty('backgroundColor')
    expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { text: 'Nothing else to say.' } })
    await ui.unmount()
  }
})

test('a reply with no agent name, or one only inside a code block, is left to the engine', async ($, on) => {
  machine(on)
  for (const text of ['Plain answer, plan mode is off.', '```\nExplore dev:architect\n```']) {
    const ui = await $.ui.mount({ plugin: 'agent-colours', surface: 'terminal', ...reply(text) })
    expect(await ui.drawn()).not.toMatchObject({ type: 'Box' })
    await ui.unmount()
  }
})
