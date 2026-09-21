import type { ClientModule, ClientKeyEvent } from 'claude-code'

/**
 * The strip under the screen. A Raster takes no keys, so this Client holds
 * the keyboard once clicked and posts what it hears to the hooks module,
 * which types it into the game.
 */

type State = { isArmed: true }

// A post not yet delivered is replaced by the next one in the same frame, so
// keys queue here and leave once per frame, never one post per key.
const FLUSH_MS = 16

const HINT = '▶ or click here for the whole keyboard: arrows, Z fire, space use, ` menu'

const Controls: ClientModule<null, State> = (_props, surface) => {
  if (surface.state === undefined) {
    let queue: { key: string; ctrl: boolean }[] = []

    surface.onKey((event: ClientKeyEvent) => {
      queue.push({ key: event.key, ctrl: event.ctrl === true })
    })

    surface.every(FLUSH_MS, () => {
      if (queue.length === 0) return
      surface.post(queue)
      queue = []
    })

    surface.setState({ isArmed: true })
  }

  const { Text } = surface.elements
  return <Text dimColor>{HINT}</Text>
}

export default Controls
