export * as BuffAccountLink from "./link.js"

import { randomBytes } from "node:crypto"
import { BuffAccountFrames } from "./frames.js"

/**
 * Связь Buff Code с сайтом аккаунта (#966): гость на публичном NATS (`wss://<сайт>/nats`).
 * Команда — публикация в `data.cmd.<op>` с адресом ответа в своём ящике `_INBOX.<gid>.<n>`;
 * ответ читается разбором кадров (`frames.ts`). Соединение одно на процесс и поднимается при
 * первой команде; в простое закрывается, оборванное — поднимается заново при следующей.
 * Команда целиком должна уместиться в одно сообщение: больше `max_payload` сервер не примет,
 * и об этом говорится сразу, а не молчанием.
 */

type Raw = Record<string, unknown>

/** То, что связи нужно от соединения: настоящее — nats.ws, в тестах — подмена. */
export interface Conn {
  readonly publish: (subject: string, data: Uint8Array) => void
  readonly subscribe: (subject: string, onMessage: (data: Uint8Array) => void) => () => void
  /** Потолок одного сообщения из приветствия сервера. */
  readonly maxPayload: () => number | undefined
  readonly close: () => Promise<void>
  /** Соединение закрылось насовсем (сеть, сервер) — с причиной или без. */
  readonly closed: Promise<unknown>
}

export interface Options {
  readonly connect: (gid: string) => Promise<Conn>
  /** Сколько ждать простого ответа. */
  readonly replyMs?: number
  /** Тишина в потоке (ни куска, ни сигнала «жив»), после которой просим повторить, а затем считаем связь мёртвой. */
  readonly silenceMs?: number
  /** Простой без команд, после которого соединение закрывается. */
  readonly idleMs?: number
}

/** Команда не умещается в одно сообщение сервера. */
export class TooLarge extends Error {
  readonly bytes: number
  readonly limit: number
  constructor(bytes: number, limit: number) {
    super(`command of ${bytes} bytes exceeds the server limit of ${limit} bytes`)
    this.bytes = bytes
    this.limit = limit
  }
}

/** Сервер ответил отказом вместо потока — его словами. */
export class Refused extends Error {
  readonly retry: boolean
  constructor(message: string, retry: boolean) {
    super(message)
    this.retry = retry
  }
}

/** Связь оборвалась или сервер замолчал. */
export class Cut extends Error {}

const DEFAULT_REPLY_MS = 30_000
const DEFAULT_SILENCE_MS = 60_000
const DEFAULT_IDLE_MS = 120_000

export interface Link {
  /** Команда с простым ответом (в том числе большим, по кускам). Отказ сервера — тоже ответ. */
  readonly ask: (op: string, fields: Raw) => Promise<Raw>
  /** Команда с потоковым ответом: куски полезной нагрузки по порядку. */
  readonly stream: (op: string, fields: Raw, signal?: AbortSignal) => AsyncGenerator<Uint8Array, void, void>
  /** Потолок одной команды в байтах, как его назвал сервер; не назвал — неизвестен. */
  readonly limit: () => Promise<number | undefined>
  readonly close: () => Promise<void>
}

export function make(options: Options): Link {
  const replyMs = options.replyMs ?? DEFAULT_REPLY_MS
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  let current: { readonly gid: string; readonly conn: Promise<Conn>; cut?: (reason: Cut) => void } | undefined
  let serial = 0
  let busy = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  const waiting = new Set<(reason: Cut) => void>()

  const open = () => {
    if (current) return current
    const gid = randomBytes(16).toString("hex")
    const mine = { gid, conn: options.connect(gid) }
    current = mine
    const drop = (reason: Cut) => {
      if (current !== mine) return
      current = undefined
      for (const fail of [...waiting]) fail(reason)
    }
    mine.conn.then(
      (conn) => void conn.closed.then(() => drop(new Cut("connection closed"))),
      () => drop(new Cut("connection failed")),
    )
    return mine
  }

  const enter = () => {
    busy++
    clearTimeout(idle)
  }
  const leave = () => {
    busy--
    if (busy > 0) return
    clearTimeout(idle)
    idle = setTimeout(() => void close(), idleMs)
    // Простой не держит процесс от выхода.
    if (typeof idle === "object" && "unref" in idle) idle.unref()
  }

  const close = async () => {
    clearTimeout(idle)
    const was = current
    current = undefined
    if (!was) return
    await was.conn.then((conn) => conn.close()).catch(() => undefined)
  }

  /** Отправить команду и слушать её адрес ответа; `stop` снимает подписку. */
  const send = async (op: string, fields: Raw, onMessage: (message: unknown) => void) => {
    const { gid, conn: pending } = open()
    const conn = await pending.catch((cause) => {
      throw new Cut(cause instanceof Error ? cause.message : String(cause))
    })
    const reply = `_INBOX.${gid}.${++serial}`
    const bytes = Buffer.from(JSON.stringify({ ...fields, op, reply }), "utf8")
    const limit = conn.maxPayload()
    if (limit !== undefined && bytes.length > limit) throw new TooLarge(bytes.length, limit)
    const stop = conn.subscribe(reply, (data) => onMessage(decode(data)))
    conn.publish(`data.cmd.${op}`, bytes)
    const control = (body: Raw) =>
      conn.publish(
        "data.cmd.stream_ctl",
        Buffer.from(JSON.stringify({ ...body, op: "stream_ctl", reply: `_INBOX.${gid}.ctl` }), "utf8"),
      )
    return { stop, control }
  }

  const ask: Link["ask"] = async (op, fields) => {
    enter()
    const reader = BuffAccountFrames.reader()
    let sent: Awaited<ReturnType<typeof send>> | undefined
    let fail: ((reason: Cut) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<Raw>((resolve, reject) => {
        fail = reject
        waiting.add(reject)
        timer = setTimeout(() => reject(new Cut("no reply")), replyMs)
        send(op, fields, (message) => {
          for (const event of reader.push(message)) if (event.type === "plain") resolve(event.reply)
        }).then((value) => (sent = value), reject)
      })
    } finally {
      clearTimeout(timer)
      if (fail) waiting.delete(fail)
      sent?.stop()
      leave()
    }
  }

  const stream: Link["stream"] = async function* (op, fields, signal) {
    enter()
    const reader = BuffAccountFrames.reader()
    const queue: BuffAccountFrames.Event[] = []
    let failure: Error | undefined
    let wake: (() => void) | undefined
    const fail = (reason: Error) => {
      failure ??= reason
      wake?.()
    }
    waiting.add(fail)
    const aborted = () => fail(new Cut("aborted"))
    signal?.addEventListener("abort", aborted, { once: true })
    let sent: Awaited<ReturnType<typeof send>> | undefined
    let finished = false
    try {
      if (signal?.aborted) throw new Cut("aborted")
      sent = await send(op, fields, (message) => {
        queue.push(...reader.push(message))
        wake?.()
      })
      let asked = false
      while (true) {
        if (failure) throw failure
        const event = queue.shift()
        if (!event) {
          const silent = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), silenceMs)
            wake = () => {
              clearTimeout(timer)
              resolve(false)
            }
          })
          wake = undefined
          if (!silent) continue
          // Тишина: один раз просим повторить с ожидаемого куска, во второй раз связь мертва.
          const at = reader.stream()
          if (asked || !at) throw new Cut("no reply")
          asked = true
          sent.control({ id: at.id, resume: at.next })
          continue
        }
        asked = false
        if (event.type === "data") yield event.bytes
        if (event.type === "ack") sent.control({ id: event.id, ack: event.seq })
        if (event.type === "resume") sent.control({ id: event.id, resume: event.seq })
        if (event.type === "failed") {
          finished = true
          throw new Cut(event.message)
        }
        if (event.type === "plain") {
          finished = true
          const error = typeof event.reply.error === "string" ? event.reply.error : "refused"
          throw new Refused(error, event.reply.retry === true)
        }
        if (event.type === "end") {
          finished = true
          return
        }
      }
    } finally {
      // Читатель ушёл раньше конца (отмена, ошибка): сервер останавливает вызов модели.
      const at = reader.stream()
      if (!finished && at && sent) {
        try {
          sent.control({ id: at.id, cancel: true })
        } catch {
          // Соединение уже закрыто: отменять нечем, сервер сам заметит молчание читателя.
        }
      }
      signal?.removeEventListener("abort", aborted)
      waiting.delete(fail)
      sent?.stop()
      leave()
    }
  }

  const limit: Link["limit"] = async () => {
    enter()
    try {
      return (await open().conn).maxPayload()
    } catch (cause) {
      throw new Cut(cause instanceof Error ? cause.message : String(cause))
    } finally {
      leave()
    }
  }

  return { ask, stream, limit, close }
}

function decode(data: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(data).toString("utf8"))
  } catch {
    return undefined
  }
}
