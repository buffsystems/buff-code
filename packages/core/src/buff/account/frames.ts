export * as BuffAccountFrames from "./frames.js"

/**
 * Ответ сервера на команду гостя (#966) приходит одним из трёх видов: простой — одно сообщение
 * без `chunk`; большой простой — куски с `of`, которые склеиваются по `seq`; поток — куски по
 * порядку до `last` или `error`, с сигналом «жив» (`beat`) в тишине. Читатель обязан
 * подтверждать поток (`ack`) и просить потерянное (`resume`). Здесь — только разбор сообщений:
 * что из них следует и что ответить; сеть и время — у связи (`link.ts`).
 */

type Raw = Record<string, unknown>

/** Сколько кусков потока принять, прежде чем подтвердить: у сервера в полёте не больше 64. */
export const ACK_EVERY = 16

export type Event =
  /** Ответ целиком — простой или склеенный из кусков. */
  | { readonly type: "plain"; readonly reply: Raw }
  /** Очередной кусок потока. */
  | { readonly type: "data"; readonly bytes: Uint8Array }
  /** Поток закончился как положено. */
  | { readonly type: "end" }
  /** Поток оборван сервером — его словами. */
  | { readonly type: "failed"; readonly message: string }
  /** Сервер жив, нового нет. */
  | { readonly type: "beat" }
  /** Что сказать серверу о потоке `id`. */
  | { readonly type: "ack"; readonly id: string; readonly seq: number }
  | { readonly type: "resume"; readonly id: string; readonly seq: number }

export interface Reader {
  /** Очередное сообщение на адресе ответа → что из него следует, по порядку. */
  readonly push: (message: unknown) => Event[]
  /** Поток, который сейчас читается: его идентификатор и номер ожидаемого куска. */
  readonly stream: () => { readonly id: string; readonly next: number } | undefined
}

export function reader(): Reader {
  const sized = new Map<number, Buffer>()
  let id: string | undefined
  let next = 0
  let asked = -1
  let done = false

  const whole = (chunk: Raw, data: unknown): Event[] => {
    const of = Number(chunk.of)
    const seq = Number(chunk.seq)
    if (!Number.isInteger(of) || !Number.isInteger(seq) || seq < 0 || seq >= of || typeof data !== "string") return []
    sized.set(seq, Buffer.from(data, "base64"))
    if (sized.size < of) return []
    const text = Buffer.concat(Array.from({ length: of }, (_, index) => sized.get(index) ?? Buffer.alloc(0))).toString(
      "utf8",
    )
    done = true
    return [{ type: "plain", reply: parse(text) ?? { ok: false, error: "malformed reply" } }]
  }

  const piece = (chunk: Raw, data: unknown): Event[] => {
    const stream = typeof chunk.id === "string" ? chunk.id : ""
    id ??= stream
    // Чужой поток на нашем адресе ответа: не наш разговор.
    if (stream !== id) return []
    if (chunk.beat === true) return [{ type: "beat" }]
    const seq = Number(chunk.seq)
    if (!Number.isInteger(seq) || seq < next) return []
    if (seq > next) {
      // Пропуск: просим повторить с ожидаемого куска — один раз на каждый пропуск.
      if (asked === next) return []
      asked = next
      return [{ type: "resume", id, seq: next }]
    }
    next = seq + 1
    if (chunk.last === true) {
      done = true
      return [{ type: "ack", id, seq }, { type: "end" }]
    }
    if (typeof chunk.error === "string") {
      done = true
      return [
        { type: "ack", id, seq },
        { type: "failed", message: chunk.error },
      ]
    }
    const bytes: Event = {
      type: "data",
      bytes: typeof data === "string" ? Buffer.from(data, "base64") : new Uint8Array(),
    }
    return next % ACK_EVERY === 0 ? [bytes, { type: "ack", id, seq }] : [bytes]
  }

  return {
    push: (message) => {
      if (done) return []
      const body = record(message)
      if (!body) return []
      const chunk = record(body.chunk)
      if (!chunk) {
        done = true
        return [{ type: "plain", reply: body }]
      }
      return "of" in chunk ? whole(chunk, body.data) : piece(chunk, body.data)
    },
    stream: () => (id === undefined || done ? undefined : { id, next }),
  }
}

function record(value: unknown): Raw | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : undefined
}

function parse(text: string): Raw | undefined {
  try {
    return record(JSON.parse(text))
  } catch {
    return undefined
  }
}
