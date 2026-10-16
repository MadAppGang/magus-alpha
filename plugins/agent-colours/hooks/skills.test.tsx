import { test, expect } from 'claude-code/testing'
import type { TestBody, Mounted } from 'claude-code/testing'
import { parseSkill, manifestSkillPaths, skillKey } from './skills'
import { badgeFromField, textColourFromField, mentionPattern } from './colours'
import { splitReply } from './mentions'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Surface = 'terminal' | 'desktop'
type Drawing = Pick<Mounted, 'drawn' | 'find' | 'findAll'>
type Data = {
  files: Record<string, string>
  dirs: Set<string>
  links: Set<string>
  env: Record<string, string | undefined>
}

// All paths below belong to the in-memory machine, never the host filesystem.
const path = (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/')
const ROOT = path('', 'testdata')
const HOME = path(ROOT, 'home')
const CONFIG = path(HOME, '.claude')
const CUSTOM_CONFIG = path(ROOT, 'custom-config')
const INSTALL = path(ROOT, 'cache', 'dev', 'new')
const OLD_INSTALL = path(ROOT, 'cache', 'dev', 'old')
const OTHER_INSTALL = path(ROOT, 'cache', 'p', 'current')
const PROJECT = '.claude'
const registryPath = (config = CONFIG) => path(config, 'plugins', 'installed_plugins.json')
const manifestPath = (root = INSTALL) => path(root, '.claude-plugin', 'plugin.json')
const skillPath = (root: string, dir: string) => path(root, 'skills', dir, 'SKILL.md')
const commandPath = (root: string, name: string) => path(root, 'commands', `${name}.md`)
const PROBE = 'qa-probe'

const doc = (name?: string, color?: string) =>
  `---\n${name === undefined ? '' : `name: ${name}\n`}${color === undefined ? '' : `color: ${color}\n`}---\nbody`
const registry = (rows: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 2, plugins: { 'dev@magus': rows, ...extra } })
const currentRow = () => ({ installPath: INSTALL, lastUpdated: '2026-09-01T00:00:00Z' })
const olderRow = () => ({ installPath: OLD_INSTALL, lastUpdated: '2026-01-01T00:00:00Z' })
const freshData = (): Data => ({
  files: {
    [registryPath()]: registry([currentRow()]),
    [manifestPath()]: JSON.stringify({ name: 'dev' }),
    [skillPath(INSTALL, 'dev')]: doc('dev', 'blue'),
    [skillPath(CONFIG, 'commit')]: doc('commit', 'red'),
    [skillPath(PROJECT, PROBE)]: doc(PROBE, 'purple'),
  },
  dirs: new Set(),
  links: new Set(),
  env: { HOME },
})

const normalize = (value: string) => {
  const absolute = value.startsWith('/')
  const segments: string[] = []
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..' && segments.length && segments[segments.length - 1] !== '..') segments.pop()
    else if (segment !== '..' || !absolute) segments.push(segment)
  }
  return `${absolute ? '/' : ''}${segments.join('/')}` || (absolute ? '/' : '.')
}
const samePath = (key: string, requested: string) =>
  key === requested || (!key.startsWith('/') && requested.endsWith(`/${key}`))

// Infer every parent directory, not just parents containing direct files. LINKS
// expose directory contents under their link name, with the link entry's public kind.
const directories = (data: Data) => {
  const dirs = new Set([...data.dirs, ...data.links])
  for (const key of [...Object.keys(data.files), ...dirs]) {
    let parent = key
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'))
      if (!parent) break
      dirs.add(parent)
    }
  }
  return dirs
}
const resolve = (data: Data, requested: string) => {
  const normalized = normalize(requested)
  return [...Object.keys(data.files), ...directories(data)].find(key => samePath(key, normalized)) ?? normalized
}
const entries = (data: Data, requested: string) => {
  const dir = resolve(data, requested)
  const dirs = directories(data)
  if (!dirs.has(dir)) return undefined
  const children = new Map<string, { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }>()
  for (const key of [...Object.keys(data.files), ...dirs]) {
    if (!key.startsWith(`${dir}/`)) continue
    const rest = key.slice(dir.length + 1)
    const name = rest.split('/')[0]
    if (!name) continue
    const child = path(dir, name)
    const isLink = data.links.has(child)
    const kind = isLink ? 'other' : dirs.has(child) || rest.includes('/') ? 'dir' : 'file'
    children.set(name, { name, kind, size: data.files[child]?.length ?? 0, mtimeMs: 0, isLink })
  }
  return [...children.values()]
}
const machine = (on: On, data: Data) => {
  on('ui.render', () => ({ type: 'engine' as const, ref: 0 }))
  on('env.get', ($, e) => ({ value: data.env[e.name] }))
  on('fs.read', ($, e) => {
    const text = data.files[resolve(data, e.path)]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', ($, e) => {
    const found = entries(data, e.path)
    return found === undefined ? { deny: `ENOENT ${e.path}` } : { value: found }
  })
  on('agent.list', () => ({ value: [] }))
}

const onSurfaces = (name: string, body: ($: Engine, on: On, surface: Surface) => unknown) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${name} [${surface}]`, ($, on) => body($, on, surface))
  }
}
const toolUse = (input: unknown, tool = 'Skill', state: Partial<{ isRunning: boolean; isErrored: boolean; isInterrupted: boolean }> = {}) => ({
  component: 'ToolUse' as const,
  props: { tool_use_id: 'toolu_skills', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...state },
})
const reply = (text: string) => ({ component: 'AssistantMessage' as const, props: { text, isFirstOfReply: true } })
const withRow = async ($: Engine, surface: Surface, input: unknown, check: (ui: Drawing) => Promise<void>, state = {}, tool = 'Skill') => {
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface, ...toolUse(input, tool, state) })
  try { await check(ui) } finally { await ui.unmount() }
}
const withReply = async ($: Engine, surface: Surface, text: string, check: (ui: Drawing) => Promise<void>) => {
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface, ...reply(text) })
  try { await check(ui) } finally { await ui.unmount() }
}
// findAll lists matches outermost first (contract: claude-code.d.ts `find`). When a
// mention is a whole line, the unstyled line Text wraps one styled span with the same
// text, so the span under test is the innermost exact match: one with no element
// descendant whose shown text is also exactly `text`.
type Child = string | { type?: string; children?: unknown[] }
const shown = (node: Child): string =>
  typeof node === 'string' ? node : (node.children ?? []).map(child => shown(child as Child)).join('')
const wrapsExact = (children: unknown[], text: string): boolean =>
  children.some(child => typeof child === 'object' && child !== null &&
    (shown(child as Child) === text || wrapsExact((child as { children?: unknown[] }).children ?? [], text)))
const exactSpan = async (ui: Drawing, text: string) =>
  (await ui.findAll({ type: 'Text', text })).find(span => span.text === text && !wrapsExact(span.children, text))
const assertColour = async (ui: Drawing, text: string, color: string, bold?: boolean) => {
  const span = await exactSpan(ui, text)
  expect(span, `a Text span displaying exactly ${JSON.stringify(text)}`).toBeDefined()
  expect(span?.text).toBe(text)
  expect(span?.props).toMatchObject({ color })
  expect(span?.props).not.toHaveProperty('backgroundColor')
  if (bold !== undefined) expect(span?.props.bold === true).toBe(bold)
}
const saturated = (name: string) => {
  const badge = badgeFromField(name)
  expect(badge, `the spec's named colour ${name}`).toBeDefined()
  return badge!.bg
}
const assertEngine = async (ui: Drawing) => {
  expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
}
const assertSkillRow = ($: Engine, surface: Surface, key: string, color: string) =>
  withRow($, surface, { skill: key }, ui => assertColour(ui, key, color, false))
const assertEngineRow = ($: Engine, surface: Surface, key: string) =>
  withRow($, surface, { skill: key }, assertEngine)
const probe = ($: Engine, surface: Surface) => assertSkillRow($, surface, PROBE, saturated('purple'))
const skillMatches = (text: string, names: string[]) =>
  [...text.matchAll(mentionPattern([], names))].map(match => ({ text: match[0], skill: match.groups?.skill }))

// Pure public contracts; no loader helpers or private state are imported.
for (const color of ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan', 'violet', 'magenta', 'grey', 'gray']) {
  test(`R1: named skill colour ${color} is the saturated badge background`, () => {
    expect(textColourFromField(color)).toBe(saturated(color))
  })
}
test('R1: green has the specified saturated colour, not a contrast foreground', () => {
  expect(textColourFromField('green')).toBe('#0A9A2E')
})
for (const color of ['#FFD700', '#aBcD12', '#000000', '#FFFFFF']) {
  test(`R2: hex ${color} is preserved byte-for-byte`, () => {
    expect(textColourFromField(color)).toBe(color)
  })
}
for (const field of ['green', '"green"', "'green'", 'Green']) {
  test(`R1 R3 R5: parseSkill reads name and ${field}`, () => {
    const skill = parseSkill(doc('renamed', field), 'folder')
    expect(skill.name).toBe('renamed')
    expect(skill.color).toBeDefined()
    expect(textColourFromField(skill.color!)).toBe('#0A9A2E')
  })
}
for (const color of ['', 'teal', '#FFF', '#GGGGGG']) {
  test(`R4: invalid colour ${JSON.stringify(color)} has no skill text colour`, () => {
    expect(textColourFromField(color)).toBeUndefined()
  })
}
test('R4 R5: missing frontmatter or colour uses only the fallback name', () => {
  expect(parseSkill('plain body', 'folder')).toEqual({ name: 'folder' })
  expect(parseSkill(doc('named'), 'folder')).toEqual({ name: 'named' })
})
test('R5: absent names use a skill directory or a command basename', () => {
  expect(parseSkill(doc(undefined, 'blue'), 'directory')).toEqual({ name: 'directory', color: 'blue' })
  expect(parseSkill(doc(undefined, 'blue'), 'command.md')).toEqual({ name: 'command', color: 'blue' })
})
test('R3 R5: CRLF and trailing blanks preserve quoted name and colour', () => {
  const parsed = parseSkill('---\r\nname: "renamed"  \r\ncolor: \'Green\'  \r\n---\r\nbody', 'folder')
  expect(parsed.name).toBe('renamed')
  expect(parsed.color).toBeDefined()
  expect(textColourFromField(parsed.color!)).toBe('#0A9A2E')
})

const manifestCases: { name: string; raw: unknown; expected: string[] }[] = [
  { name: 'a single path', raw: JSON.stringify({ skills: 'skills/nested' }), expected: ['skills/nested'] },
  { name: 'leading ./ and trailing /', raw: JSON.stringify({ skills: './skills/nested/' }), expected: ['skills/nested'] },
  { name: 'an array ignores non-strings', raw: JSON.stringify({ skills: ['./skills/a/', null, 9, false, {}, ['skills/b'], 'skills/c'] }), expected: ['skills/a', 'skills/c'] },
  { name: 'the plugin root', raw: JSON.stringify({ skills: ['', './', '.'] }), expected: ['.', '.', '.'] },
  { name: 'absolute and parent-segment paths', raw: JSON.stringify({ skills: ['/elsewhere', '../evil', './skills/../evil', 'skills/x/../../evil', 'safe..', '..safe', './skills/good/'] }), expected: ['safe..', '..safe', 'skills/good'] },
  { name: 'missing field', raw: '{}', expected: [] },
  { name: 'non-string field', raw: '{"skills":42}', expected: [] },
  { name: 'bad JSON', raw: '{broken', expected: [] },
  { name: 'undefined read', raw: undefined, expected: [] },
  { name: 'null read', raw: null, expected: [] },
  { name: 'non-text read', raw: { skills: 'skills/a' }, expected: [] },
]
for (const scenario of manifestCases) {
  test(`R7 R13 R14: manifest paths handle ${scenario.name}`, () => {
    expect(manifestSkillPaths(scenario.raw)).toEqual(scenario.expected)
  })
}
for (const [input, expected] of [
  [{ skill: 'dev:dev' }, 'dev:dev'], [{ skill: '/dev:dev' }, 'dev:dev'],
  [{ skill: '  x ' }, 'x'], [{ skill: '  /dev:dev  ', args: 'ignored' }, 'dev:dev'],
  [{ skill: '' }, undefined], [{ skill: '   ' }, undefined], [{ skill: '/' }, undefined],
  [{ skill: 7 }, undefined], [{ skill: null }, undefined], [{}, undefined], [undefined, undefined], [null, undefined],
] as const) {
  test(`R18 R19: skillKey normalizes ${JSON.stringify(input)}`, () => {
    expect(skillKey(input)).toBe(expected)
  })
}

test('R24 R27 R28: no effective skill names leaves the agent pattern unchanged', () => {
  const agents = ['dev:architect', 'c++']
  const original = mentionPattern(agents)
  for (const skills of [[], ['dev:architect'], ['Plan']]) {
    const extended = mentionPattern(agents, skills)
    expect(extended.source).toBe(original.source)
    expect(extended.flags).toBe(original.flags)
  }
})
test('R22 R23 R24: only a qualified or slash skill mention matches', () => {
  expect(skillMatches('commit dev dev:dev /commit /dev:dev', ['commit', 'dev:dev'])).toEqual([
    { text: 'dev:dev', skill: 'dev:dev' },
    { text: '/commit', skill: '/commit' },
    { text: '/dev:dev', skill: '/dev:dev' },
  ])
})
const allowedStarts = ['', ' ', '\t', '\n', '\n\n', '(', '[', '"', "'", '**', '`']
for (const prefix of allowedStarts) {
  test(`R25: slash mention starts after ${JSON.stringify(prefix)}`, () => {
    expect(skillMatches(`${prefix}/commit`, ['commit'])).toEqual([{ text: '/commit', skill: '/commit' }])
  })
}
const blockedStarts = ['a', '7', '_', '-', '.', ':', '/', '~', 'src', 'https://x.dev']
for (const prefix of blockedStarts) {
  test(`R25: slash mention does not start after ${JSON.stringify(prefix)}`, () => {
    expect(skillMatches(`${prefix}/commit`, ['commit'])).toEqual([])
  })
}
const blockedEnds = ['s', 'Z', '7', '_', '-', ':', '/', '.md', '.7', '._', '-all', '/x']
for (const suffix of blockedEnds) {
  test(`R26: slash mention does not end before ${JSON.stringify(suffix)}`, () => {
    expect(skillMatches(`/commit${suffix}`, ['commit'])).toEqual([])
  })
}
for (const suffix of ['', '.', ',', ')', ']', '!', '?', ' ', '\n']) {
  test(`R26: slash mention ends before ${JSON.stringify(suffix)}`, () => {
    expect(skillMatches(`/commit${suffix}`, ['commit'])).toEqual([{ text: '/commit', skill: '/commit' }])
  })
}
test('R27: custom and built-in agents win over same-named skill matches', () => {
  const matches = [...'dev:architect /dev:architect Plan /Plan'.matchAll(mentionPattern(['dev:architect'], ['dev:architect', 'Plan']))]
  expect(matches.map(match => match[0])).toEqual(['dev:architect', 'dev:architect', 'Plan', 'Plan'])
  expect(matches.every(match => match.groups?.skill === undefined)).toBe(true)
})
test('R23: splitReply marks a slash skill span with its slash-free key', () => {
  const spans = splitReply('/commit', mentionPattern([], ['commit']))?.flatMap(block => block.kind === 'styled' ? block.lines.flat() : [])
  expect(spans?.filter(span => span.mention).map(span => ({ text: span.text, mention: span.mention }))).toEqual([
    { text: '/commit', mention: { kind: 'skill', name: 'commit' } },
  ])
})
test('R28: a group-less public reply pattern still marks an agent', () => {
  const spans = splitReply('Explore', /Explore/g)?.flatMap(block => block.kind === 'styled' ? block.lines.flat() : [])
  expect(spans?.filter(span => span.mention).map(span => ({ text: span.text, mention: span.mention }))).toEqual([
    { text: 'Explore', mention: { kind: 'agent', name: 'Explore' } },
  ])
})
test('R28: adding unrelated skill keys leaves agent-only reply blocks identical', () => {
  const before = mentionPattern(['dev:architect'])
  const after = mentionPattern(['dev:architect'], ['commit', 'dev:dev'])
  for (const text of [
    'Explore found it; dev:architect agrees.', '**Explore** and `dev:architect`.',
    '# Explore\n\nPlain **paragraph**.', '````\nExplore dev:architect\n````', 'Nothing special here.',
  ]) {
    expect(splitReply(text, after)).toEqual(splitReply(text, before))
  }
})
test('R32: regex punctuation in user and qualified keys is literal', () => {
  expect(skillMatches('/c++ /p:c++ p:c++ /a.b /aXb', ['c++', 'p:c++', 'a.b'])).toEqual([
    { text: '/c++', skill: '/c++' }, { text: '/p:c++', skill: '/p:c++' },
    { text: 'p:c++', skill: 'p:c++' }, { text: '/a.b', skill: '/a.b' },
  ])
})
test('R33: longer coloured key is matched as one complete span', () => {
  expect(skillMatches('/dev:dev-review dev:dev-review /dev:dev', ['dev:dev', 'dev:dev-review'])).toEqual([
    { text: '/dev:dev-review', skill: '/dev:dev-review' },
    { text: 'dev:dev-review', skill: 'dev:dev-review' },
    { text: '/dev:dev', skill: '/dev:dev' },
  ])
})

// Discovery is checked only through the mounted row/reply drawing.
for (const field of ['green', '"green"', "'green'", 'Green']) {
  onSurfaces(`R1 R3 R6: auto-scanned plugin skill reads color: ${field}`, async ($, on, surface) => {
    const data = freshData()
    data.files[skillPath(INSTALL, 'dev')] = doc('dev', field)
    machine(on, data)
    await assertSkillRow($, surface, 'dev:dev', '#0A9A2E')
    await withReply($, surface, 'Use dev:dev.', ui => assertColour(ui, 'dev:dev', '#0A9A2E'))
  })
}
onSurfaces('R2: a bright hex colours the skill text, never a contrast foreground', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(INSTALL, 'dev')] = doc('dev', '"#FFD700"')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:dev', '#FFD700')
  await withReply($, surface, '/dev:dev next.', ui => assertColour(ui, '/dev:dev', '#FFD700'))
})
const uncolouredDocs = [
  { label: 'no colour', text: doc('dev') }, { label: 'unknown colour', text: doc('dev', 'teal') },
  { label: 'short hex', text: doc('dev', '"#FFF"') }, { label: 'invalid hex', text: doc('dev', '"#GGGGGG"') },
  { label: 'no frontmatter', text: 'body without frontmatter' },
]
for (const scenario of uncolouredDocs) {
  onSurfaces(`R4 R19: ${scenario.label} means engine row and reply, without a fallback`, async ($, on, surface) => {
    const data = freshData()
    data.files[skillPath(INSTALL, 'dev')] = scenario.text
    machine(on, data)
    await probe($, surface)
    await assertEngineRow($, surface, 'dev:dev')
    await withReply($, surface, 'Use dev:dev or /dev:dev.', assertEngine)
  })
}
onSurfaces('R5 R6 R8: frontmatter names override skill directories and command filenames', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(INSTALL, 'directory')] = doc('renamed', 'green')
  data.files[commandPath(INSTALL, 'filename')] = doc('launch', 'orange')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:renamed', saturated('green'))
  await assertSkillRow($, surface, 'dev:launch', saturated('orange'))
  await assertEngineRow($, surface, 'dev:directory')
  await assertEngineRow($, surface, 'dev:filename')
})
onSurfaces('R5 R6 R8: absent names use directory and command basenames', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(INSTALL, 'directory')] = doc(undefined, 'green')
  data.files[commandPath(INSTALL, 'launch')] = doc(undefined, 'orange')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:directory', saturated('green'))
  await assertSkillRow($, surface, 'dev:launch', saturated('orange'))
  await assertEngineRow($, surface, 'dev:launch.md')
})
onSurfaces('R3 R5: a CRLF skill uses its quoted name and colour', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(INSTALL, 'directory')] = '---\r\nname: "renamed"  \r\ncolor: \'Green\'  \r\n---\r\nbody'
  machine(on, data)
  await assertSkillRow($, surface, 'dev:renamed', '#0A9A2E')
})
onSurfaces('R6 R9: an install with only subdirectories exists and keeps its namespace', async ($, on, surface) => {
  const data = freshData()
  delete data.files[manifestPath()]
  data.files[registryPath()] = registry([currentRow()], { 'p@other': [{ installPath: OTHER_INSTALL, lastUpdated: '2026-09-01T00:00:00Z' }] })
  data.files[skillPath(OTHER_INSTALL, 'dev')] = doc('dev', 'green')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:dev', saturated('blue'))
  await assertSkillRow($, surface, 'p:dev', saturated('green'))
  await assertEngineRow($, surface, 'dev')
})
for (const manifest of ['knowledge/nested', './knowledge/nested/', ['knowledge/nested'], ['./knowledge/nested/']]) {
  onSurfaces(`R7: listed individual nested skill ${JSON.stringify(manifest)}`, async ($, on, surface) => {
    const data = freshData()
    data.files[manifestPath()] = JSON.stringify({ skills: manifest })
    data.files[path(INSTALL, 'knowledge', 'nested', 'SKILL.md')] = doc(undefined, 'pink')
    machine(on, data)
    await assertSkillRow($, surface, 'dev:nested', saturated('pink'))
    await assertSkillRow($, surface, 'dev:dev', saturated('blue'))
  })
}
onSurfaces('R7: listed container discovers each direct child and uses frontmatter names', async ($, on, surface) => {
  const data = freshData()
  data.files[manifestPath()] = JSON.stringify({ skills: ['./knowledge/group/'] })
  data.files[path(INSTALL, 'knowledge', 'group', 'one', 'SKILL.md')] = doc('first', 'green')
  data.files[path(INSTALL, 'knowledge', 'group', 'two', 'SKILL.md')] = doc(undefined, 'yellow')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:first', saturated('green'))
  await assertSkillRow($, surface, 'dev:two', saturated('yellow'))
})
onSurfaces('R7: a listed skill file is one skill, not a container of its children', async ($, on, surface) => {
  const data = freshData()
  data.files[manifestPath()] = JSON.stringify({ skills: 'knowledge/nested' })
  data.files[path(INSTALL, 'knowledge', 'nested', 'SKILL.md')] = doc('parent', 'green')
  data.files[path(INSTALL, 'knowledge', 'nested', 'child', 'SKILL.md')] = doc('child', 'red')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:parent', saturated('green'))
  await assertEngineRow($, surface, 'dev:child')
})
onSurfaces('R7: the explicitly listed plugin root can hold a named SKILL.md', async ($, on, surface) => {
  const data = freshData()
  data.files[manifestPath()] = JSON.stringify({ skills: './' })
  data.files[path(INSTALL, 'SKILL.md')] = doc('root-skill', 'green')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:root-skill', saturated('green'))
})
onSurfaces('R8: only direct command files supply colours', async ($, on, surface) => {
  const data = freshData()
  data.files[commandPath(INSTALL, 'launch')] = doc(undefined, 'orange')
  data.files[path(INSTALL, 'commands', 'sub', 'nested.md')] = doc('nested', 'green')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:launch', saturated('orange'))
  await assertEngineRow($, surface, 'dev:nested')
  await assertEngineRow($, surface, 'dev:sub:nested')
})
onSurfaces('R9: newest existing row wins even when registry order is reversed', async ($, on, surface) => {
  const data = freshData()
  data.files[registryPath()] = registry([currentRow(), olderRow()])
  data.files[skillPath(OLD_INSTALL, 'dev')] = doc('dev', 'red')
  data.files[skillPath(OLD_INSTALL, 'old-only')] = doc(undefined, 'red')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:dev', saturated('blue'))
  await assertEngineRow($, surface, 'dev:old-only')
})
onSurfaces('R9: a missing newest install falls back to the next newest existing directory', async ($, on, surface) => {
  const data = freshData()
  data.files[registryPath()] = registry([currentRow(), olderRow()])
  delete data.files[manifestPath()]
  delete data.files[skillPath(INSTALL, 'dev')]
  data.files[skillPath(OLD_INSTALL, 'dev')] = doc('dev', 'red')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:dev', saturated('red'))
})
onSurfaces('R9: an existing empty newest install does not borrow an older colour', async ($, on, surface) => {
  const data = freshData()
  data.files[registryPath()] = registry([olderRow(), currentRow()])
  delete data.files[manifestPath()]
  delete data.files[skillPath(INSTALL, 'dev')]
  data.dirs.add(INSTALL)
  data.files[skillPath(OLD_INSTALL, 'dev')] = doc('dev', 'red')
  machine(on, data)
  await probe($, surface)
  await assertEngineRow($, surface, 'dev:dev')
})
onSurfaces('R9 R11: newest uncoloured definition does not inherit an older install colour', async ($, on, surface) => {
  const data = freshData()
  data.files[registryPath()] = registry([olderRow(), currentRow()])
  data.files[skillPath(OLD_INSTALL, 'dev')] = doc('dev', 'red')
  data.files[skillPath(INSTALL, 'dev')] = doc('dev')
  machine(on, data)
  await probe($, surface)
  await assertEngineRow($, surface, 'dev:dev')
})

for (const [label, file] of [
  ['user skill', skillPath(CONFIG, 'own')], ['user command', commandPath(CONFIG, 'own')],
  ['project skill', skillPath(PROJECT, 'own')], ['project command', commandPath(PROJECT, 'own')],
]) {
  onSurfaces(`R10: ${label} supplies a bare key`, async ($, on, surface) => {
    const data = freshData()
    data.files[file] = doc('own', 'green')
    machine(on, data)
    await assertSkillRow($, surface, 'own', saturated('green'))
    await assertEngineRow($, surface, 'dev:own')
    await withReply($, surface, '/own next.', ui => assertColour(ui, '/own', saturated('green')))
  })
}
for (const homePresent of [true, false]) {
  onSurfaces(`R10 R13: CLAUDE_CONFIG_DIR supplies skills, commands and plugin registry (HOME ${homePresent ? 'set' : 'unset'})`, async ($, on, surface) => {
    const data = freshData()
    data.env = { HOME: homePresent ? HOME : undefined, CLAUDE_CONFIG_DIR: CUSTOM_CONFIG }
    data.files[skillPath(CUSTOM_CONFIG, 'commit')] = doc('commit', 'green')
    data.files[commandPath(CUSTOM_CONFIG, 'launch')] = doc('launch', 'orange')
    data.files[registryPath(CUSTOM_CONFIG)] = registry([{ installPath: OLD_INSTALL, lastUpdated: '2026-01-01T00:00:00Z' }])
    data.files[skillPath(OLD_INSTALL, 'dev')] = doc('dev', 'yellow')
    machine(on, data)
    await assertSkillRow($, surface, 'commit', saturated('green'))
    await assertSkillRow($, surface, 'launch', saturated('orange'))
    await assertSkillRow($, surface, 'dev:dev', saturated('yellow'))
    await probe($, surface)
  })
}
const precedencePaths = [
  commandPath(CONFIG, 'choice'), skillPath(CONFIG, 'choice'),
  commandPath(PROJECT, 'choice'), skillPath(PROJECT, 'choice'),
]
const precedenceNames = ['user command', 'user skill', 'project command', 'project skill']
for (let winner = 0; winner < precedencePaths.length; winner++) {
  onSurfaces(`R11: ${precedenceNames[winner]} wins over all lower bare-key definitions`, async ($, on, surface) => {
    const data = freshData()
    for (let lower = 0; lower < winner; lower++) data.files[precedencePaths[lower]] = doc('choice', ['red', 'blue', 'yellow'][lower])
    data.files[precedencePaths[winner]] = doc('choice', 'green')
    machine(on, data)
    await assertSkillRow($, surface, 'choice', saturated('green'))
    await withReply($, surface, '/choice next.', ui => assertColour(ui, '/choice', saturated('green')))
  })
  if (!winner) continue
  for (const missingColour of [undefined, 'teal']) {
    onSurfaces(`R11: ${precedenceNames[winner]} with ${missingColour ?? 'no colour'} removes lower colours`, async ($, on, surface) => {
      const data = freshData()
      for (let lower = 0; lower < winner; lower++) data.files[precedencePaths[lower]] = doc('choice', 'red')
      data.files[precedencePaths[winner]] = doc('choice', missingColour)
      machine(on, data)
      await probe($, surface)
      await assertEngineRow($, surface, 'choice')
      await withReply($, surface, '/choice next.', assertEngine)
    })
  }
}
for (const color of ['green', undefined]) {
  onSurfaces(`R11: plugin skill ${color ?? 'without colour'} overrides its command`, async ($, on, surface) => {
    const data = freshData()
    data.files[commandPath(INSTALL, 'choice')] = doc('choice', 'red')
    data.files[skillPath(INSTALL, 'choice')] = doc('choice', color)
    machine(on, data)
    await probe($, surface)
    if (color) await assertSkillRow($, surface, 'dev:choice', saturated(color))
    else await assertEngineRow($, surface, 'dev:choice')
    await withReply($, surface, 'dev:choice next.', color ? ui => assertColour(ui, 'dev:choice', saturated(color)) : assertEngine)
  })
}
onSurfaces('R12: a user skill directory exposed as a symbolic link counts', async ($, on, surface) => {
  const data = freshData()
  data.links.add(path(CONFIG, 'skills', 'linked'))
  data.files[skillPath(CONFIG, 'linked')] = doc('linked', 'cyan')
  machine(on, data)
  await assertSkillRow($, surface, 'linked', saturated('cyan'))
  await withReply($, surface, '/linked next.', ui => assertColour(ui, '/linked', saturated('cyan')))
})

const degradeCases: { label: string; setup: (data: Data) => void; pluginColour?: string; commandColour?: string; userColour?: string }[] = [
  { label: 'missing registry', setup: data => { delete data.files[registryPath()] }, userColour: 'red' },
  { label: 'unparseable registry', setup: data => { data.files[registryPath()] = '{broken' }, userColour: 'red' },
  { label: 'missing plugin skills directory', setup: data => { delete data.files[skillPath(INSTALL, 'dev')]; data.files[commandPath(INSTALL, 'launch')] = doc('launch', 'orange') }, commandColour: 'orange', userColour: 'red' },
  { label: 'missing plugin commands directory', setup: () => {}, pluginColour: 'blue', userColour: 'red' },
  { label: 'missing plugin manifest', setup: data => { delete data.files[manifestPath()] }, pluginColour: 'blue', userColour: 'red' },
  { label: 'manifest without skills field', setup: () => {}, pluginColour: 'blue', userColour: 'red' },
  { label: 'manifest with non-string skills entries', setup: data => { data.files[manifestPath()] = JSON.stringify({ skills: [null, 7, {}, './knowledge/good/'] }); data.files[path(INSTALL, 'knowledge', 'good', 'SKILL.md')] = doc('good', 'green') }, pluginColour: 'blue', userColour: 'red' },
  { label: 'non-string installPath entries', setup: data => { data.files[registryPath()] = registry([{ installPath: null, lastUpdated: '2026-10-01T00:00:00Z' }, { installPath: 7, lastUpdated: '2026-10-02T00:00:00Z' }, currentRow()]) }, pluginColour: 'blue', userColour: 'red' },
  { label: 'only a non-string installPath', setup: data => { data.files[registryPath()] = registry([{ installPath: {}, lastUpdated: '2026-10-02T00:00:00Z' }]) }, userColour: 'red' },
  { label: 'HOME and CLAUDE_CONFIG_DIR both unset', setup: data => { data.env = {} } },
  { label: 'missing user skills and commands directories', setup: data => { delete data.files[skillPath(CONFIG, 'commit')] }, pluginColour: 'blue' },
]
for (const scenario of degradeCases) {
  onSurfaces(`R13: ${scenario.label} removes only its supplied colours`, async ($, on, surface) => {
    const data = freshData()
    scenario.setup(data)
    machine(on, data)
    await probe($, surface)
    if (scenario.pluginColour) await assertSkillRow($, surface, 'dev:dev', saturated(scenario.pluginColour))
    else await assertEngineRow($, surface, 'dev:dev')
    if (scenario.commandColour) await assertSkillRow($, surface, 'dev:launch', saturated(scenario.commandColour))
    else await assertEngineRow($, surface, 'dev:launch')
    if (scenario.userColour) await assertSkillRow($, surface, 'commit', saturated(scenario.userColour))
    else await assertEngineRow($, surface, 'commit')
    if (scenario.label === 'manifest with non-string skills entries') await assertSkillRow($, surface, 'dev:good', saturated('green'))
    await withReply($, surface, `/${PROBE} still works.`, ui => assertColour(ui, `/${PROBE}`, saturated('purple')))
  })
}
onSurfaces('R13: missing project skills and commands leave user and plugin colours available', async ($, on, surface) => {
  const data = freshData()
  delete data.files[skillPath(PROJECT, PROBE)]
  machine(on, data)
  await assertSkillRow($, surface, 'commit', saturated('red'))
  await assertSkillRow($, surface, 'dev:dev', saturated('blue'))
  await assertEngineRow($, surface, PROBE)
})
onSurfaces('R14: absolute and parent-traversal manifest paths cannot supply colours', async ($, on, surface) => {
  const data = freshData()
  const outside = path(ROOT, 'outside')
  const sibling = normalize(path(INSTALL, '..', 'sibling'))
  data.files[manifestPath()] = JSON.stringify({ skills: [outside, '../sibling', './knowledge/../../sibling', './knowledge/good/'] })
  data.files[path(outside, 'SKILL.md')] = doc('absolute-escape', 'red')
  data.files[path(sibling, 'SKILL.md')] = doc('parent-escape', 'red')
  data.files[path(INSTALL, 'knowledge', 'good', 'SKILL.md')] = doc('good', 'green')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:good', saturated('green'))
  await assertEngineRow($, surface, 'dev:absolute-escape')
  await assertEngineRow($, surface, 'dev:parent-escape')
})
onSurfaces('R15: editing a loaded colour does not change redraws or another mount in that load', async ($, on, surface) => {
  const data = freshData()
  machine(on, data)
  const ui = await $.ui.mount({ plugin: 'agent-colours', surface, ...toolUse({ skill: 'dev:dev' }) })
  try {
    await assertColour(ui, 'dev:dev', saturated('blue'), false)
    data.files[skillPath(INSTALL, 'dev')] = doc('dev', 'green')
    await ui.redraw()
    await assertColour(ui, 'dev:dev', saturated('blue'), false)
    await withReply($, surface, 'dev:dev next.', drawing => assertColour(drawing, 'dev:dev', saturated('blue')))
  } finally { await ui.unmount() }
  await assertSkillRow($, surface, 'dev:dev', saturated('blue'))
})
onSurfaces('R15: a fresh harness load reads the edited colour at the same path', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(INSTALL, 'dev')] = doc('dev', 'green')
  machine(on, data)
  await assertSkillRow($, surface, 'dev:dev', saturated('green'))
  await withReply($, surface, 'dev:dev next.', ui => assertColour(ui, 'dev:dev', saturated('green')))
})

// Tool row contract: order, call state and delegation to the engine.
onSurfaces('R16 R21: Skill row draws the exact five texts with a bold label and an unpadded coloured name', async ($, on, surface) => {
  machine(on, freshData())
  await withRow($, surface, { skill: 'dev:dev' }, async ui => {
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.map(text => text.text)).toEqual(['● ', 'Skill', '(', 'dev:dev', ')'])
    expect(texts[1].props.bold).toBe(true)
    await assertColour(ui, 'dev:dev', saturated('blue'), false)
  })
})
for (const scenario of [
  { label: 'success', state: {}, color: 'success', dim: false },
  { label: 'error', state: { isErrored: true }, color: 'error', dim: false },
  { label: 'running', state: { isRunning: true }, color: undefined, dim: true },
]) {
  onSurfaces(`R17 R21: ${scenario.label} dot has the engine call-state styling`, async ($, on, surface) => {
    machine(on, freshData())
    await withRow($, surface, { skill: 'dev:dev' }, async ui => {
      const dot = await exactSpan(ui, '● ')
      expect(dot).toBeDefined()
      expect(dot?.props.color).toBe(scenario.color)
      if (scenario.dim) expect(dot?.props.dimColor).toBe(true)
      else expect(dot?.props.dimColor).not.toBe(true)
      await assertColour(ui, 'dev:dev', saturated('blue'), false)
    }, scenario.state)
  })
}
onSurfaces('R18 R21: slash is ignored for lookup but kept in the row name', async ($, on, surface) => {
  machine(on, freshData())
  await assertSkillRow($, surface, '/dev:dev', saturated('blue'))
})
for (const input of [undefined, null, {}, { skill: '' }, { skill: '   ' }, { skill: '/' }, { skill: 3 }, { skill: false }, { skill: [] }, { skill: {} }, { skill: 'missing' }]) {
  onSurfaces(`R19 R21: malformed or uncoloured Skill input ${JSON.stringify(input)} stays engine-drawn`, async ($, on, surface) => {
    machine(on, freshData())
    await probe($, surface)
    await withRow($, surface, input, assertEngine)
  })
}
onSurfaces('R19 R21: an interrupted coloured call keeps the engine interrupted marker', async ($, on, surface) => {
  machine(on, freshData())
  await probe($, surface)
  await withRow($, surface, { skill: 'dev:dev' }, assertEngine, { isInterrupted: true })
})
for (const tool of ['Bash', 'Read']) {
  onSurfaces(`R19 R21: ${tool} is engine-drawn even with a coloured skill-like input`, async ($, on, surface) => {
    machine(on, freshData())
    await probe($, surface)
    await withRow($, surface, { skill: 'dev:dev', command: 'ls' }, assertEngine, {}, tool)
  })
}
const collisionData = (skillColor?: string) => {
  const data = freshData()
  data.files[path(INSTALL, 'agents', 'architect.md')] = doc('architect', 'red')
  data.files[skillPath(INSTALL, 'architect')] = doc('architect', skillColor)
  return data
}
onSurfaces('R20 R21 R28: Skill uses its green field while the same-named Agent keeps its red badge', async ($, on, surface) => {
  machine(on, collisionData('green'))
  await assertSkillRow($, surface, 'dev:architect', saturated('green'))
  await withRow($, surface, { subagent_type: 'dev:architect', description: 'Design', prompt: 'x' }, async ui => {
    const badge = await exactSpan(ui, ' dev:architect ')
    expect(badge?.text).toBe(' dev:architect ')
    expect(badge?.props).toMatchObject({ backgroundColor: saturated('red') })
  }, {}, 'Agent')
})
onSurfaces('R20 R21: an agent colour does not colour an uncoloured same-named Skill', async ($, on, surface) => {
  machine(on, collisionData())
  await probe($, surface)
  await assertEngineRow($, surface, 'dev:architect')
})
onSurfaces('R20 R27: built-in agent colours do not replace a Skill row colour', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(PROJECT, 'Plan')] = doc('Plan', 'blue')
  machine(on, data)
  await assertSkillRow($, surface, 'Plan', saturated('blue'))
})

// Replies: compare the visible span's text/style and untouched Markdown blocks.
onSurfaces('R22: a qualified mention draws text colour without badge padding', async ($, on, surface) => {
  machine(on, freshData())
  await withReply($, surface, 'Run dev:dev next.', ui => assertColour(ui, 'dev:dev', saturated('blue'), false))
})
onSurfaces('R23: user and plugin slash mentions include their slash in the coloured span', async ($, on, surface) => {
  machine(on, freshData())
  await withReply($, surface, '/commit then /dev:dev.', async ui => {
    await assertColour(ui, '/commit', saturated('red'), false)
    await assertColour(ui, '/dev:dev', saturated('blue'), false)
  })
})
for (const text of ['commit', 'dev', 'Please commit before using dev.', 'No coloured mentions here.']) {
  onSurfaces(`R24 R31: bare words and unrelated text stay engine-drawn (${JSON.stringify(text)})`, async ($, on, surface) => {
    machine(on, freshData())
    await probe($, surface)
    await withReply($, surface, text, assertEngine)
  })
}
onSurfaces('R24: bare words are not coloured in a paragraph that also has a real mention', async ($, on, surface) => {
  machine(on, freshData())
  await withReply($, surface, 'commit and dev are words; /commit and dev:dev are mentions.', async ui => {
    await assertColour(ui, '/commit', saturated('red'))
    await assertColour(ui, 'dev:dev', saturated('blue'))
    const coloured = (await ui.findAll({ type: 'Text' })).filter(span => span.props.color === saturated('red') || span.props.color === saturated('blue'))
    expect(coloured.map(span => span.text)).toEqual(['/commit', 'dev:dev'])
  })
})
for (const text of ['/commit', ' /commit', '\t/commit', 'before\n/commit', 'before\n\n/commit', '(/commit)', '[/commit]', '"/commit"', "'/commit'"]) {
  onSurfaces(`R25: allowed token-start context colours the slash span (${JSON.stringify(text)})`, async ($, on, surface) => {
    machine(on, freshData())
    await withReply($, surface, text, ui => assertColour(ui, '/commit', saturated('red')))
  })
}
for (const prefix of blockedStarts) {
  onSurfaces(`R25: blocked token-start context stays engine-drawn (${JSON.stringify(prefix)})`, async ($, on, surface) => {
    machine(on, freshData())
    await probe($, surface)
    await withReply($, surface, `${prefix}/commit`, assertEngine)
  })
}
for (const suffix of blockedEnds) {
  onSurfaces(`R26: blocked token-end context stays engine-drawn (${JSON.stringify(suffix)})`, async ($, on, surface) => {
    machine(on, freshData())
    await probe($, surface)
    await withReply($, surface, `/commit${suffix}`, assertEngine)
  })
}
for (const text of ['/commit.', '/commit,', '(/commit)', '/commit!', '/commit?']) {
  onSurfaces(`R26: sentence punctuation preserves the slash mention (${JSON.stringify(text)})`, async ($, on, surface) => {
    machine(on, freshData())
    await withReply($, surface, text, ui => assertColour(ui, '/commit', saturated('red')))
  })
}
for (const text of ['dev:architect', '/dev:architect']) {
  onSurfaces(`R27 R28: overlapping agent keeps its badge and a slash stays plain (${text})`, async ($, on, surface) => {
    machine(on, collisionData('green'))
    await assertSkillRow($, surface, 'dev:architect', saturated('green'))
    await withReply($, surface, text, async ui => {
      const badge = await exactSpan(ui, ' dev:architect ')
      expect(badge?.text).toBe(' dev:architect ')
      expect(badge?.props).toMatchObject({ backgroundColor: saturated('red') })
      expect(await exactSpan(ui, 'dev:architect')).toBeUndefined()
      expect(await exactSpan(ui, '/dev:architect')).toBeUndefined()
      if (text.startsWith('/')) {
        const slash = await exactSpan(ui, '/')
        expect(slash).toBeDefined()
        expect(slash?.props).not.toHaveProperty('backgroundColor')
        expect(slash?.props.color).not.toBe(saturated('green'))
      }
    })
  })
}
onSurfaces('R27 R28: a built-in agent name remains a badge when also a coloured skill', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(PROJECT, 'Plan')] = doc('Plan', 'blue')
  machine(on, data)
  await assertSkillRow($, surface, 'Plan', saturated('blue'))
  await withReply($, surface, '/Plan', async ui => {
    const badge = await exactSpan(ui, ' Plan ')
    expect(badge?.text).toBe(' Plan ')
    expect(badge?.props).toMatchObject({ backgroundColor: saturated('green') })
    expect((await exactSpan(ui, '/'))?.props).not.toHaveProperty('backgroundColor')
    expect(await exactSpan(ui, '/Plan')).toBeUndefined()
  })
})
onSurfaces('R28: agent-only reply keeps padded badges and its untouched plain paragraph', async ($, on, surface) => {
  machine(on, collisionData('green'))
  await withReply($, surface, '**Explore** found it; dev:architect agrees.\n\nNothing else to say.', async ui => {
    expect((await exactSpan(ui, ' Explore '))?.props).toHaveProperty('backgroundColor')
    expect((await exactSpan(ui, ' dev:architect '))?.props).toMatchObject({ backgroundColor: saturated('red') })
    expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { text: 'Nothing else to say.' } })
  })
})
for (const scenario of [
  { text: '**/commit**', mention: '/commit', bold: true },
  { text: '**dev:dev**', mention: 'dev:dev', bold: true },
  { text: '`/commit`', mention: '/commit', bold: false },
  { text: '`dev:dev`', mention: 'dev:dev', bold: false },
  { text: '# /commit', mention: '/commit', bold: true },
  { text: '## dev:dev', mention: 'dev:dev', bold: true },
]) {
  onSurfaces(`R25 R29: markdown styling survives while skill colour wins (${JSON.stringify(scenario.text)})`, async ($, on, surface) => {
    machine(on, freshData())
    await withReply($, surface, scenario.text, async ui => {
      await assertColour(ui, scenario.mention, saturated(scenario.mention === '/commit' ? 'red' : 'blue'), scenario.bold)
      if (scenario.text.startsWith('`')) expect((await exactSpan(ui, scenario.mention))?.props.color).not.toBe('permission')
    })
  })
}
for (const text of ['```\n/commit\n```', '```ts\ndev:dev\n```', '```\n/commit dev:dev /dev:dev\n```']) {
  onSurfaces(`R30: fenced-only mentions leave the entire reply engine-drawn (${JSON.stringify(text)})`, async ($, on, surface) => {
    machine(on, freshData())
    await probe($, surface)
    await withReply($, surface, text, assertEngine)
  })
}
onSurfaces('R30 R31: a fence stays Markdown when another paragraph has an active mention', async ($, on, surface) => {
  machine(on, freshData())
  const fence = '```ts\n/commit dev:dev\n```'
  await withReply($, surface, `/commit next.\n\n${fence}`, async ui => {
    await assertColour(ui, '/commit', saturated('red'))
    const markdown = await ui.findAll({ type: 'Markdown' })
    expect(markdown.map(block => block.props.text)).toContain(fence)
    expect(await exactSpan(ui, 'dev:dev')).toBeUndefined()
    expect((await ui.findAll({ type: 'Text', text: '/commit' })).filter(span => span.text === '/commit')).toHaveLength(1)
  })
})
onSurfaces('R31: only mentioned paragraphs redraw; plain markdown remains byte-for-byte intact', async ($, on, surface) => {
  machine(on, freshData())
  const before = 'A plain **bold** paragraph with commit.'
  const after = 'Another `plain` paragraph.'
  await withReply($, surface, `${before}\n\nRun dev:dev next.\n\n${after}`, async ui => {
    await assertColour(ui, 'dev:dev', saturated('blue'))
    const markdown = await ui.findAll({ type: 'Markdown' })
    expect(markdown.map(block => block.props.text)).toEqual([before, after])
  })
})
onSurfaces('R32: literal punctuation in user and plugin skill names draws the right colour', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(PROJECT, 'cpp')] = doc('c++', 'green')
  data.files[skillPath(PROJECT, 'dotted')] = doc('a.b', 'yellow')
  data.files[registryPath()] = registry([currentRow()], { 'p@other': [{ installPath: OTHER_INSTALL, lastUpdated: '2026-09-01T00:00:00Z' }] })
  data.files[skillPath(OTHER_INSTALL, 'cpp')] = doc('c++', 'orange')
  machine(on, data)
  await withReply($, surface, '/c++ and /p:c++ and p:c++ and /a.b.', async ui => {
    await assertColour(ui, '/c++', saturated('green'))
    await assertColour(ui, '/p:c++', saturated('orange'))
    await assertColour(ui, 'p:c++', saturated('orange'))
    await assertColour(ui, '/a.b', saturated('yellow'))
  })
  await withReply($, surface, '/aXb', assertEngine)
})
onSurfaces('R33: longer skill name takes its own colour in a single span', async ($, on, surface) => {
  const data = freshData()
  data.files[skillPath(INSTALL, 'dev-review')] = doc('dev-review', 'pink')
  machine(on, data)
  await withReply($, surface, '/dev:dev-review next.', async ui => {
    await assertColour(ui, '/dev:dev-review', saturated('pink'))
    expect(await exactSpan(ui, '/dev:dev')).toBeUndefined()
    const coloured = (await ui.findAll({ type: 'Text' })).filter(span => span.props.color === saturated('blue') || span.props.color === saturated('pink'))
    expect(coloured.map(span => span.text)).toEqual(['/dev:dev-review'])
  })
})
