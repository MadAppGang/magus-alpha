/**
 * Turns a `tmux capture-pane -p -e -N` frame into a Raster's `cells`: standard
 * base64 of little-endian u32 triplets `[codePoint, foreground, background]`,
 * row-major, exactly `columns * rows` of them.
 */

export type Grid = { columns: number; rows: number }

type Pen = { fg: number; bg: number }

// The picture is the game's, not the terminal's: a cell with no colour of its
// own is black, so a light theme does not show through the frame.
const BLACK = 0x000000

const SPACE = 0x20
const UPPER_HALF = 0x2580
const FULL_BLOCK = 0x2588

// doom-cli's quadrant glyphs by lit sub-cells: bit 0 upper left, 1 upper
// right, 2 lower left, 3 lower right, as its `quadrants[]` table orders them.
const QUADRANT_MASK = new Map<number, number>([
  [SPACE, 0], [0x2598, 1], [0x259d, 2], [0x2580, 3],
  [0x2596, 4], [0x258c, 5], [0x259e, 6], [0x259b, 7],
  [0x2597, 8], [0x259a, 9], [0x2590, 10], [0x259c, 11],
  [0x2584, 12], [0x2599, 13], [0x259f, 14], [FULL_BLOCK, 15],
])

const BASIC = [
  0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5,
  0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff,
]

function xterm256(n: number): number {
  if (n < 16) return BASIC[n] ?? BLACK
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return (v << 16) | (v << 8) | v
  }
  const i = n - 16
  const level = (c: number) => (c === 0 ? 0 : 55 + c * 40)
  return (level(Math.floor(i / 36)) << 16) | (level(Math.floor(i / 6) % 6) << 8) | level(i % 6)
}

function applySgr(params: string, pen: Pen): void {
  const p = params === '' ? [0] : params.split(';').map(n => Number(n) || 0)

  for (let i = 0; i < p.length; i++) {
    const code = p[i] ?? 0

    if (code === 0) {
      pen.fg = BLACK
      pen.bg = BLACK
    } else if (code === 39) {
      pen.fg = BLACK
    } else if (code === 49) {
      pen.bg = BLACK
    } else if (code === 38 || code === 48) {
      let color: number | undefined
      if (p[i + 1] === 2) {
        color = ((p[i + 2] ?? 0) << 16) | ((p[i + 3] ?? 0) << 8) | (p[i + 4] ?? 0)
        i += 4
      } else if (p[i + 1] === 5) {
        color = xterm256(p[i + 2] ?? 0)
        i += 2
      }
      if (color !== undefined) {
        if (code === 38) pen.fg = color
        else pen.bg = color
      }
    } else if (code >= 30 && code <= 37) {
      pen.fg = BASIC[code - 30] ?? BLACK
    } else if (code >= 90 && code <= 97) {
      pen.fg = BASIC[code - 90 + 8] ?? BLACK
    } else if (code >= 40 && code <= 47) {
      pen.bg = BASIC[code - 40] ?? BLACK
    } else if (code >= 100 && code <= 107) {
      pen.bg = BASIC[code - 100 + 8] ?? BLACK
    }
  }
}

// A Raster refuses the whole tree over one cell that is not a width-1 BMP
// character, so control characters blank out and anything past the BMP (the
// sextant glyphs at U+1FB00) becomes a full block in its foreground colour.
function glyphOf(codePoint: number): number {
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return SPACE
  if (codePoint > 0xffff) return FULL_BLOCK
  return codePoint
}

function blankWords(grid: Grid, bg = BLACK): Uint32Array {
  const words = new Uint32Array(grid.columns * grid.rows * 3)
  for (let cell = 0; cell < grid.columns * grid.rows; cell++) {
    words[cell * 3] = SPACE
    words[cell * 3 + 1] = BLACK
    words[cell * 3 + 2] = bg
  }
  return words
}

export function encode(words: Uint32Array): string {
  return new Uint8Array(words.buffer).toBase64()
}

/**
 * Paints the captured text over a black grid. SGR state carries across lines
 * as it would on a terminal; rows and columns past the grid are dropped, and
 * missing ones stay black.
 */
export function wordsOf(frame: string, grid: Grid): Uint32Array {
  const words = blankWords(grid)
  const pen: Pen = { fg: BLACK, bg: BLACK }
  const lines = frame.split('\n')

  for (let row = 0; row < grid.rows && row < lines.length; row++) {
    const line = lines[row] ?? ''
    let column = 0
    let i = 0

    while (i < line.length) {
      if (line.charCodeAt(i) === 0x1b) {
        const next = line[i + 1]
        if (next === '[') {
          let end = i + 2
          while (end < line.length && !/[@-~]/.test(line[end] ?? '')) end++
          if (line[end] === 'm') applySgr(line.slice(i + 2, end), pen)
          i = end + 1
          continue
        }
        if (next === ']') {
          // OSC (a hyperlink, a title): skip to BEL or ESC \.
          let end = i + 2
          while (end < line.length && line.charCodeAt(end) !== 0x07 && line.charCodeAt(end) !== 0x1b) end++
          i = line.charCodeAt(end) === 0x1b ? end + 2 : end + 1
          continue
        }
        i += 2
        continue
      }

      const codePoint = line.codePointAt(i) ?? SPACE
      i += codePoint > 0xffff ? 2 : 1

      if (column < grid.columns) {
        const cell = (row * grid.columns + column) * 3
        words[cell] = glyphOf(codePoint)
        words[cell + 1] = pen.fg
        words[cell + 2] = pen.bg
      }
      column++
    }
  }

  return words
}

/** Unpacks quadrant cells into a pixel grid two wide and two tall per cell. */
function pixelsOf(words: Uint32Array, grid: Grid): Uint32Array {
  const width = grid.columns * 2
  const pixels = new Uint32Array(width * grid.rows * 2)

  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const cell = (row * grid.columns + column) * 3
      const glyph = words[cell] ?? SPACE
      const fg = words[cell + 1] ?? BLACK
      const bg = words[cell + 2] ?? BLACK
      const mask = QUADRANT_MASK.get(glyph) ?? (glyph === SPACE ? 0 : 15)
      const top = row * 2 * width + column * 2
      pixels[top] = mask & 1 ? fg : bg
      pixels[top + 1] = mask & 2 ? fg : bg
      pixels[top + width] = mask & 4 ? fg : bg
      pixels[top + width + 1] = mask & 8 ? fg : bg
    }
  }

  return pixels
}

/**
 * Resamples a frame to another cell grid. The same grid passes through as
 * drawn; any other becomes upper-half blocks, one exact colour per half, each
 * sampled from the nearest source pixel. The caller keeps the proportions.
 */
export function fitWords(words: Uint32Array, source: Grid, target: Grid): Uint32Array {
  if (source.columns === target.columns && source.rows === target.rows) return words

  const pixels = pixelsOf(words, source)
  const width = source.columns * 2
  const height = source.rows * 2
  const out = new Uint32Array(target.columns * target.rows * 3)

  for (let row = 0; row < target.rows; row++) {
    const top = Math.min(height - 1, Math.floor(((row + 0.25) * height) / target.rows))
    const bottom = Math.min(height - 1, Math.floor(((row + 0.75) * height) / target.rows))
    for (let column = 0; column < target.columns; column++) {
      const x = Math.min(width - 1, Math.floor(((column + 0.5) * width) / target.columns))
      const cell = (row * target.columns + column) * 3
      out[cell] = UPPER_HALF
      out[cell + 1] = pixels[top * width + x] ?? BLACK
      out[cell + 2] = pixels[bottom * width + x] ?? BLACK
    }
  }

  return out
}

/**
 * The largest grid of the source's proportions that fits the room, never
 * larger than the source: shrinking loses detail, growing only adds blur.
 */
export function fitGrid(source: Grid, room: Grid): Grid {
  if (room.columns >= source.columns && room.rows >= source.rows) return source
  const columns = Math.max(1, Math.min(room.columns, Math.floor((room.rows * source.columns) / source.rows)))
  const rows = Math.max(1, Math.min(room.rows, Math.round((columns * source.rows) / source.columns)))
  return { columns, rows }
}

/**
 * How many rows of the capture carry anything: the last line with any bytes.
 * doom-cli opens every frame with a clear screen, and tmux applies the ~60 KB
 * that follows in chunks, so a capture taken mid-frame ends early.
 */
export function paintedRowsOf(frame: string): number {
  const lines = frame.split('\n')
  for (let row = lines.length - 1; row >= 0; row--) {
    if ((lines[row] ?? '').length > 0) return row + 1
  }
  return 0
}

/**
 * A dark grid with lines of text centred on it: what the Raster shows before
 * the first captured frame arrives.
 */
export function bannerWords(lines: readonly string[], grid: Grid, fg = 0xcc2200): Uint32Array {
  const words = blankWords(grid)

  const top = Math.max(0, Math.floor((grid.rows - lines.length) / 2))
  lines.forEach((text, index) => {
    const row = top + index
    if (row >= grid.rows) return
    const glyphs = [...text].slice(0, grid.columns)
    const left = Math.max(0, Math.floor((grid.columns - glyphs.length) / 2))
    glyphs.forEach((glyph, offset) => {
      const cell = (row * grid.columns + left + offset) * 3
      words[cell] = glyphOf(glyph.codePointAt(0) ?? SPACE)
      words[cell + 1] = fg
    })
  })

  return words
}
