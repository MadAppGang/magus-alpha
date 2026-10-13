// Pure parsing of agent definitions; register.tsx does the reading, since the engine
// lets only functions declared in the hooks module itself receive `$`.

export type Row = { installPath?: unknown; lastUpdated?: unknown }
type Registry = { plugins?: Record<string, Row[]> }

const field = (frontmatter: string, key: string): string | undefined => {
  const m = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(frontmatter)
  return m?.[1]?.replace(/^(['"])(.*)\1$/, '$2') || undefined
}

export const parseAgent = (text: string, fileName: string): { name: string; color?: string } => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  return { name: field(fm, 'name') ?? fileName.replace(/\.md$/, ''), color: field(fm, 'color') }
}

// Each installed plugin's name with its install rows, newest first: one plugin has a
// row per install, and the newest whose agents exist speaks for it.
export const pluginInstalls = (raw: unknown): [plugin: string, rows: Row[]][] => {
  let registry: Registry = {}
  try {
    if (typeof raw === 'string') registry = JSON.parse(raw) as Registry
  } catch {
    // An unreadable registry means no plugin agents get a colour from it.
  }
  return Object.entries(registry.plugins ?? {}).map(([id, rows]) => [
    id.split('@')[0] ?? id,
    [...rows].sort((a, b) => String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? ''))),
  ])
}
