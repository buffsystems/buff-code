export * as BuffAccountUpload from "./upload.js"

import { randomBytes } from "node:crypto"
import { BuffAccountLink } from "./link.js"

/**
 * Большой запрос к модели (#966). Команда должна уместиться в одно сообщение сервера (1 МБ), а
 * долгая сессия или картинка в него не умещаются. Тогда тело запроса уходит частями
 * (`chat_model_part`): по одной, по порядку, дожидаясь ответа на каждую, — а закрывающий
 * `chat_model_call` называет отправленное вместо тела. Запрос, который умещается, идёт как
 * раньше, одним сообщением. Здесь — как тело режется и что делать с отказами; сеть — у связи.
 */

type Raw = Record<string, unknown>

/**
 * Пределы большого запроса. Их задаёт оператор установки, и сервер называет их клиенту; пока не
 * назвал, действуют значения из контракта — они записаны только здесь. Неназванные пределы —
 * лишь ориентир для размера части: отказывает в слишком большом запросе сам сервер, своими словами.
 */
export interface Limits {
  /** Потолок собранного тела, байт. */
  readonly bodyMax: number
  /** Потолок одной части, байт тела. */
  readonly pieceMax: number
  /** Сколько частей в одном запросе. */
  readonly piecesMax: number
  /** Пределы назвал сервер: тогда слишком большой запрос не отправляется вовсе. */
  readonly named: boolean
}

export const DEFAULTS: Limits = { bodyMax: 16 * 1_048_576, pieceMax: 720_000, piecesMax: 64, named: false }

/** Пределы, которые назвал сервер (`chat_models.request`); не назвал — значения контракта. */
export function limits(
  request: { readonly maxBytes: number; readonly pieceBytes: number; readonly maxPieces: number } | undefined,
): Limits {
  if (!request) return DEFAULTS
  return { bodyMax: request.maxBytes, pieceMax: request.pieceBytes, piecesMax: request.maxPieces, named: true }
}

/** Запас на конверт команды: токен, адрес ответа, метки. */
export const ENVELOPE = 4096

const LOST_MAX = 2
const BUSY_MAX = 3
/** Так сервер говорит, что хранилище занято: ту же часть можно послать снова. */
const BUSY = new Set(["модели сейчас недоступны", "models are unavailable right now"])

/** Умещается ли запрос с таким телом в одно сообщение. Потолок не назван — шлём целиком. */
export function fits(bodyBytes: number, maxPayload: number | undefined): boolean {
  return !maxPayload || maxPayload <= 0 || bodyBytes + ENVELOPE <= maxPayload
}

/** Сколько байт тела в одной части: по пределу сервера и потолку сообщения соединения, кратно трём. */
export function pieceSize(maxPayload: number | undefined, limits: Limits = DEFAULTS): number {
  const room = !maxPayload || maxPayload <= 0 ? limits.pieceMax : Math.floor(((maxPayload - ENVELOPE) * 3) / 4)
  const size = Math.min(limits.pieceMax, room)
  return Math.max(3, size - (size % 3))
}

/**
 * На сколько частей резать тело. `undefined` — сервер такое не примет: больше названного им
 * потолка тела или числа частей. Пределы не названы — режем как есть, отказ скажет сервер.
 */
export function plan(
  bodyBytes: number,
  maxPayload: number | undefined,
  limits: Limits = DEFAULTS,
): { size: number; of: number } | undefined {
  if (limits.named && bodyBytes > limits.bodyMax) return undefined
  const size = pieceSize(maxPayload, limits)
  const of = Math.max(1, Math.ceil(bodyBytes / size))
  return limits.named && of > limits.piecesMax ? undefined : { size, of }
}

/** Идентификатор отправки: случайный, новый для каждого запроса. */
export const uploadID = (): string => `u_${randomBytes(12).toString("base64url")}`

export interface Ports {
  /** Команда `chat_model_part` с простым ответом. */
  readonly ask: (fields: Raw) => Promise<Raw>
  readonly token: (renew: boolean) => Promise<string>
  readonly id?: () => string
  /** Пауза перед повтором части, которую хранилище не приняло. */
  readonly pause?: (ms: number) => Promise<void>
}

/** Тело больше, чем сервер принимает. */
export class TooBig extends Error {}

/**
 * Отправить тело частями. Возвращает идентификатор для закрывающего вызова и токен, с которым
 * дошла последняя часть (он мог обновиться). Отказ сервера — `Refused` его словами.
 */
export async function send(
  ports: Ports,
  body: Uint8Array,
  maxPayload: number | undefined,
  signal?: AbortSignal,
  held?: string,
  limits: Limits = DEFAULTS,
): Promise<{ id: string; token: string }> {
  const cut = plan(body.length, maxPayload, limits)
  if (!cut) throw new TooBig()
  const id = (ports.id ?? uploadID)()
  const pause = ports.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let token = held ?? (await ports.token(false))
  let renewed = false
  let lost = 0
  let busy = 0
  let seq = 0
  let sends = 0
  while (seq < cut.of) {
    if (signal?.aborted) throw new BuffAccountLink.Cut("aborted")
    // Сервер, который не продвигается, не держит отправку вечно.
    if (sends++ > cut.of * 3 + 8) throw new BuffAccountLink.Cut("the upload does not advance")
    const data = Buffer.from(body.subarray(seq * cut.size, (seq + 1) * cut.size)).toString("base64")
    const reply = await ports.ask({ token, chunk: { id, seq, of: cut.of }, data }).catch((cause: unknown) => {
      // Ответ потерялся: ту же часть можно послать снова — сервер не посчитает её дважды.
      if (cause instanceof BuffAccountLink.Cut && lost++ < LOST_MAX) return undefined
      throw cause
    })
    if (!reply) continue
    if (reply.ok !== false) {
      // Следующая — та, которую ждёт сервер.
      const received = Number(reply.received)
      seq = Number.isInteger(received) && received >= 0 && received <= cut.of ? received : seq + 1
      continue
    }
    const error = typeof reply.error === "string" ? reply.error : "refused"
    if (error === "token expired" && !renewed) {
      renewed = true
      token = await ports.token(true)
      continue
    }
    const transient = reply.retry === true || BUSY.has(error)
    if (transient && busy++ < BUSY_MAX) {
      await pause(500 * busy)
      continue
    }
    throw new BuffAccountLink.Refused(error, transient)
  }
  return { id, token }
}
