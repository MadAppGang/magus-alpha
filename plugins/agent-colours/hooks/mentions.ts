// Splits a reply into the parts the engine keeps drawing as markdown and the
// paragraphs that name an agent, which the mod draws itself as styled spans.

export type Span = { text: string; bold?: boolean; code?: boolean; agent?: string }
export type Block = { kind: 'markdown'; text: string } | { kind: 'styled'; lines: Span[][] }

const FENCE = /^\s*(```|~~~)/

// Paragraphs, never cutting through a fenced code block, whose names stay as written.
const paragraphs = (text: string): { text: string; isCode: boolean }[] => {
  const out: { text: string; isCode: boolean }[] = []
  let current: string[] = []
  let inFence = false
  let hasFence = false
  const flush = () => {
    if (current.length) out.push({ text: current.join('\n'), isCode: hasFence })
    current = []
    hasFence = false
  }
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      if (!inFence) flush()
      inFence = !inFence
      hasFence = true
      current.push(line)
      if (!inFence) flush()
      continue
    }
    if (!inFence && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return out
}

const withMentions = (text: string, pattern: RegExp, style: Omit<Span, 'text'>): Span[] => {
  const spans: Span[] = []
  let last = 0
  for (const m of text.matchAll(new RegExp(pattern.source, 'g'))) {
    const at = m.index ?? 0
    if (at > last) spans.push({ ...style, text: text.slice(last, at) })
    spans.push({ ...style, text: m[0], agent: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) spans.push({ ...style, text: text.slice(last) })
  return spans
}

// The inline markdown a styled paragraph keeps: **bold**, `code`, and headings as bold.
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`/g

const lineSpans = (line: string, pattern: RegExp): Span[] => {
  const heading = /^#{1,6}\s+(.*)$/.exec(line)
  if (heading) return withMentions(heading[1] ?? '', pattern, { bold: true })
  const spans: Span[] = []
  let last = 0
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) spans.push(...withMentions(line.slice(last, at), pattern, {}))
    if (m[1] !== undefined) spans.push(...withMentions(m[1], pattern, { bold: true }))
    else spans.push(...withMentions(m[2] ?? '', pattern, { code: true }))
    last = at + m[0].length
  }
  if (last < line.length) spans.push(...withMentions(line.slice(last), pattern, {}))
  return spans
}

export const splitReply = (text: string, pattern: RegExp): Block[] | undefined => {
  const blocks: Block[] = []
  let hasMention = false
  for (const p of paragraphs(text)) {
    const mentions = !p.isCode && new RegExp(pattern.source).test(p.text)
    if (mentions) {
      hasMention = true
      blocks.push({ kind: 'styled', lines: p.text.split('\n').map(l => lineSpans(l, pattern)) })
      continue
    }
    const prev = blocks[blocks.length - 1]
    if (prev?.kind === 'markdown') prev.text += `\n\n${p.text}`
    else blocks.push({ kind: 'markdown', text: p.text })
  }
  return hasMention ? blocks : undefined
}
