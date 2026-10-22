// A terminal's live link to its PTY (#584), the Solid terminal's socket handling as a plain
// controller: it resumes from the last cursor it saw, follows the server's cursor frames, and when
// the socket drops abnormally it reconnects with backoff (250 ms doubling to 4 s) unless the PTY is
// gone — then it fails once, so the pane can replace the dead PTY.

export type PtySocketEvents = { open: Event; message: MessageEvent; close: CloseEvent }
type PtyListener<Type extends keyof PtySocketEvents> = (event: PtySocketEvents[Type]) => void

/** The part of a WebSocket the controller uses. */
export type PtySocket = {
  readonly readyState: number
  send(data: string): void
  close(code?: number): void
  addEventListener<Type extends keyof PtySocketEvents>(type: Type, listener: PtyListener<Type>): void
  removeEventListener<Type extends keyof PtySocketEvents>(type: Type, listener: PtyListener<Type>): void
}

export type PtyConnectionInput = {
  /** Open a socket resuming at `cursor` (-1: from the restored screen's end, 0: from the start). */
  connect: (cursor: number) => Promise<PtySocket>
  /** Whether the PTY exited or no longer exists on the server. */
  gone: () => Promise<boolean>
  cursor: number
  onOpen: () => void
  onOutput: (data: string) => void
  onFail: (error: unknown) => void
  closedError: (code: number) => Error
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

const OPEN = 1
const CLOSING = 2
const CLOSED = 3

export const retryDelay = (tries: number) => Math.min(250 * 2 ** Math.min(tries, 4), 4_000)

export function createPtyConnection(input: PtyConnectionInput) {
  const setTimer = input.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const decoder = new TextDecoder()
  const state = {
    socket: undefined as PtySocket | undefined,
    drop: undefined as (() => void) | undefined,
    timer: undefined as unknown,
    tries: 0,
    failed: false,
    disposed: false,
    cursor: input.cursor >= 0 ? input.cursor : 0,
    seek: input.cursor,
  }

  const fail = (error: unknown) => {
    if (state.disposed || state.failed) return
    state.failed = true
    input.onFail(error)
  }

  const retry = (error: unknown) => {
    if (state.disposed || state.timer !== undefined) return
    state.timer = setTimer(async () => {
      state.timer = undefined
      if (state.disposed) return
      if (await input.gone()) return fail(error)
      if (state.disposed) return
      state.tries += 1
      void open()
    }, retryDelay(state.tries))
  }

  const message = (event: MessageEvent) => {
    if (state.disposed) return
    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data)
      if (bytes[0] !== 0) return
      try {
        const next = (JSON.parse(decoder.decode(bytes.subarray(1))) as { cursor?: unknown })?.cursor
        if (typeof next === "number" && Number.isSafeInteger(next) && next >= 0) {
          state.cursor = next
          state.seek = next
        }
      } catch {
        // A malformed control frame carries nothing to resume from.
      }
      return
    }
    const data = typeof event.data === "string" ? event.data : ""
    if (!data) return
    input.onOutput(data)
    state.cursor += data.length
    state.seek = state.cursor
  }

  const open = async () => {
    if (state.disposed) return
    state.drop?.()
    const socket = await input.connect(state.seek).catch((error: unknown) => {
      fail(error)
      return undefined
    })
    if (!socket || state.failed) return
    if (state.disposed) return socket.close(1000)
    state.socket = socket
    const opened = () => {
      if (state.disposed) return
      state.tries = 0
      input.onOpen()
    }
    const detach = () => {
      socket.removeEventListener("open", opened)
      socket.removeEventListener("message", message)
      socket.removeEventListener("close", closed)
      if (state.socket === socket) state.socket = undefined
      if (state.drop === stop) state.drop = undefined
    }
    const stop = () => {
      detach()
      if (socket.readyState !== CLOSED && socket.readyState !== CLOSING) socket.close(1000)
    }
    const closed = (event: CloseEvent) => {
      detach()
      if (state.disposed || event.code === 1000) return
      retry(input.closedError(event.code))
    }
    state.drop = stop
    socket.addEventListener("open", opened)
    socket.addEventListener("message", message)
    socket.addEventListener("close", closed)
  }

  return {
    open: () => void open(),
    send(data: string) {
      if (state.socket?.readyState === OPEN) state.socket.send(data)
    },
    cursor: () => state.cursor,
    dispose() {
      state.disposed = true
      if (state.timer !== undefined) clearTimer(state.timer)
      state.drop?.()
    },
  }
}
