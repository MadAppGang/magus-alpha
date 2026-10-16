// Pure parsing of skill and command definitions; register.tsx does the reading, since
// the engine lets only functions declared in the hooks module itself receive `$`.
import { parseAgent } from './agents'

export type SkillDef = { name: string; color?: string }

// A skill's frontmatter follows the agent rules exactly: `name:` and `color:`, quotes
// stripped, CRLF tolerated. `fallbackName` names it when `name:` is absent: the folder
// name for a SKILL.md, the file name for a command (a trailing `.md` is dropped).
export const parseSkill = (text: string, fallbackName: string): SkillDef => parseAgent(text, fallbackName)

// The plugin manifest's `skills` field as clean paths relative to the plugin root.
// `raw` is the plugin.json text; anything unreadable gives no paths. Absolute paths and
// any path with a `..` segment are dropped, so a manifest never reaches outside its plugin.
export const manifestSkillPaths = (raw: unknown): string[] => {
  let field: unknown
  try {
    if (typeof raw === 'string') field = (JSON.parse(raw) as { skills?: unknown } | null)?.skills
  } catch {
    return []
  }
  const listed = typeof field === 'string' ? [field] : Array.isArray(field) ? field : []
  const paths: string[] = []
  for (const entry of listed) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) continue
    const clean = trimmed.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
    if (clean.split('/').includes('..')) continue
    paths.push(clean === '' ? '.' : clean)
  }
  return paths
}

// The key a Skill tool input names: `skill` trimmed, one leading `/` dropped.
export const skillKey = (input: unknown): string | undefined => {
  const skill = (input as { skill?: unknown } | null | undefined)?.skill
  if (typeof skill !== 'string') return undefined
  const key = skill.trim().replace(/^\//, '')
  return key || undefined
}
