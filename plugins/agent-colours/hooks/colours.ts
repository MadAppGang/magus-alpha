// The badge look of Claude Code's own `color:` agent field: a saturated background
// under the full agent name, white or black text, whichever reads on it.
export type Badge = { bg: string; fg: string }

const WHITE = '#FFFFFF'
const BLACK = '#000000'

// The values Claude Code's `color:` field takes, plus a few older ones our agents used.
const NAMED: Record<string, Badge> = {
  red: { bg: '#E0102A', fg: WHITE },
  blue: { bg: '#0A5AF0', fg: WHITE },
  green: { bg: '#0A9A2E', fg: WHITE },
  yellow: { bg: '#E0A00F', fg: BLACK },
  purple: { bg: '#7A30E0', fg: WHITE },
  orange: { bg: '#FF6A10', fg: BLACK },
  pink: { bg: '#FF55AA', fg: BLACK },
  cyan: { bg: '#80C8FF', fg: BLACK },
  violet: { bg: '#A050F0', fg: BLACK },
  magenta: { bg: '#FF55AA', fg: BLACK },
  grey: { bg: '#5A6070', fg: WHITE },
  gray: { bg: '#5A6070', fg: WHITE },
}

// A `#RRGGBB` value gets white or black text by its perceived brightness.
const fromHex = (hex: string): Badge | undefined => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return undefined
  const [r, g, b] = [m[1], m[2], m[3]].map(c => parseInt(c ?? '0', 16))
  const brightness = (0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)) / 255
  return { bg: hex, fg: brightness > 0.6 ? BLACK : WHITE }
}

export const badgeFromField = (color: string): Badge | undefined => NAMED[color.toLowerCase()] ?? fromHex(color)

// The built-in agents have no definition file, so no `color:` field.
const BUILT_IN: Record<string, Badge> = {
  Explore: NAMED.cyan as Badge,
  Plan: NAMED.green as Badge,
  'general-purpose': NAMED.grey as Badge,
}

const FALLBACK: Badge[] = Object.values(NAMED)

// FNV-1a: an agent with no `color:` field always lands on the same badge.
const hash = (text: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// `colours` is each agent type's `color:` field, from loadAgentColours.
export const badgeFor = (agentType: string | undefined, colours: ReadonlyMap<string, string>): Badge => {
  const type = agentType || 'general-purpose'
  const field = colours.get(type)
  return (
    (field && badgeFromField(field)) ||
    BUILT_IN[type] ||
    FALLBACK[hash(type) % FALLBACK.length] ||
    (NAMED.grey as Badge)
  )
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A skill's text colour: a named value's saturated colour (the badge background), or a
// `#RRGGBB` value as written. Undefined for anything else, which means "not coloured".
export const textColourFromField = (color: string): string | undefined => badgeFromField(color)?.bg

const longestFirst = (names: Iterable<string>): string[] => [...names].sort((a, b) => b.length - a.length).map(escape)

// A skill mention never starts inside a path or URL, and never runs on into a longer
// word, path or file name; sentence punctuation after it is fine.
const SKILL_BEFORE = '(?<![\\w./:~-])'
const SKILL_AFTER = '(?![\\w:/-]|\\.\\w)'

// Matches every agent name a reply can mention: the built-ins, every agent with a
// `color:` field, and the types this session spawned. Longest first, so
// `dev:developer` wins over a bare `developer`; never inside a longer word.
//
// `skillNames` are the coloured skill keys; `agentNames` beyond `names`, when given, are
// further names that count as agents only for excluding skills (an agent file with no
// `color:`). A name that is an agent stays an agent. Skill matches sit in the `skill`
// named group: `/name` for any skill, `plugin:name` bare. With no skills left, the
// pattern is exactly the agents-only one.
export const mentionPattern = (
  names: Iterable<string>,
  skillNames: Iterable<string> = [],
  agentNames: Iterable<string> = [],
): RegExp => {
  const all = new Set([...Object.keys(BUILT_IN), ...names])
  all.delete('teammate')
  const agents = `(?<![\\w:-])(?:${longestFirst(all).join('|')})(?![\\w:-])`
  const notSkills = new Set([...all, ...agentNames])
  const skills = [...new Set(skillNames)].filter(s => s && !notSkills.has(s))
  if (!skills.length) return new RegExp(agents, 'g')
  const qualified = skills.filter(s => s.includes(':'))
  const alternatives = [`/(?:${longestFirst(skills).join('|')})`]
  if (qualified.length) alternatives.push(`(?:${longestFirst(qualified).join('|')})`)
  return new RegExp(`${agents}|(?<skill>${SKILL_BEFORE}(?:${alternatives.join('|')})${SKILL_AFTER})`, 'g')
}
