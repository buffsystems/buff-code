export * as BuffAccountCall from "./call.js"

import { BuffAccountLink } from "./link.js"
import { BuffAccountUpload } from "./upload.js"

/**
 * Вызов модели подписки (#966). Слой моделей говорит по HTTP с OpenAI-совместимым адресом, а
 * у личного аккаунта такого адреса нет: модели зовутся командой `chat_model_call` через гостевое
 * соединение. Здесь HTTP-запрос превращается в команду, а поток её кусков — обратно в ответ
 * HTTP: первая строка нагрузки — статус и тип, дальше тело как от OpenAI-совместимого сервера
 * (SSE проходит как есть). Отказы подписки остаются словами сервера и не повторяются по кругу.
 */

type Raw = Record<string, unknown>

export interface Ports {
  /** Токен доступа; `renew` — обновить пару, даже если срок токена ещё не вышел. */
  readonly token: (renew: boolean) => Promise<string>
  readonly stream: (fields: Raw, signal: AbortSignal) => AsyncIterable<Uint8Array>
  /** Язык отказов сервера. */
  readonly lang: () => string
  /** Одна часть большого запроса (`chat_model_part`) с простым ответом. */
  readonly part: (fields: Raw) => Promise<Raw>
  /** Потолок одного сообщения, как его назвал сервер. */
  readonly limit: () => Promise<number | undefined>
  /** Пределы большого запроса, как их назвал сервер; не назвал — значения контракта. */
  readonly limits: () => BuffAccountUpload.Limits
  /** Слова о запросе больше потолка сервера — на языке человека. */
  readonly tooLarge: (limit: number) => string
  /** Слова об оборванной связи — на языке человека. */
  readonly lost: () => string
  /** Слова о сбое модели посреди ответа — вместо слов шлюза. */
  readonly failed: () => string
}

/** Отказы, которые повтор не исправит: о них человеку говорят сразу. */
const FINAL = new Set([
  "invalid_token",
  "invalid_request_error",
  "unknown_tier",
  "no_subscription",
  "subscription_readonly",
  "subscription_blocked",
  "budget_exceeded",
  "rate_limit_exceeded",
  "upload_expired",
  "upload_incomplete",
  "request_too_large",
])

/** Метки расхода едут заголовками, как у моделей организации. */
const TAGS = { session: "x-buff-session", message: "x-buff-message", call: "x-buff-call" } as const

/** HTTP-запрос к OpenAI-совместимому адресу → поля команды `chat_model_call`; `sized` узнаёт размер тела в байтах. */
export async function command(request: Request, sized?: (bytes: number) => void): Promise<Raw> {
  return (await read(request, sized)).fields
}

/** Поля команды и само тело запроса байтами — ими оно уходит частями, если не умещается в сообщение. */
async function read(request: Request, sized?: (bytes: number) => void) {
  const path = new URL(request.url).pathname.replace(/^.*\/v1\//, "").replace(/^\/+|\/+$/g, "")
  const text = await request.text()
  const bytes = Buffer.from(text, "utf8")
  sized?.(bytes.length)
  const body = parse(text) ?? {}
  const fields: Raw = {
    tier: typeof body.model === "string" ? body.model : "",
    path,
    body,
    ...Object.fromEntries(
      Object.entries(TAGS).flatMap(([field, header]) => {
        const value = request.headers.get(header)
        return value ? [[field, value]] : []
      }),
    ),
  }
  return { fields, bytes }
}

/** Ответ с ошибкой в виде OpenAI-совместимого сервера. */
function refusal(status: number, type: string, message: string, final: boolean): Response {
  return new Response(JSON.stringify({ error: { message, type, code: status } }), {
    status,
    headers: { "content-type": "application/json", ...(final ? { "x-should-retry": "false" } : {}) },
  })
}

/** Поток кусков нагрузки → ответ HTTP. Первая строка — статус и тип; граница кусков произвольна. */
export async function response(pieces: AsyncIterable<Uint8Array>, failed?: () => string): Promise<Response> {
  const iterator = pieces[Symbol.asyncIterator]()
  const head: Uint8Array[] = []
  let rest: Uint8Array | undefined
  while (rest === undefined) {
    const next = await iterator.next()
    if (next.done) throw new BuffAccountLink.Cut("the reply ended before it began")
    const at = next.value.indexOf(10)
    if (at === -1) {
      head.push(next.value)
      continue
    }
    head.push(next.value.subarray(0, at))
    rest = next.value.subarray(at + 1)
  }
  const meta = parse(Buffer.concat(head).toString("utf8"))
  const status = Number(meta?.status)
  if (!meta || !Number.isInteger(status) || status < 200 || status > 599) {
    await iterator.return?.()
    throw new BuffAccountLink.Cut("the reply has no status line")
  }
  const type = typeof meta.content_type === "string" && meta.content_type ? meta.content_type : "application/json"

  if (status >= 400) {
    // Отказ короток: читаем его целиком, чтобы по виду решить, стоит ли повторять.
    const body = [rest]
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) body.push(next.value)
    const text = Buffer.concat(body).toString("utf8")
    const kind = (parse(text)?.error as Raw | undefined)?.type
    return new Response(text, {
      status,
      headers: {
        "content-type": type,
        ...(typeof kind === "string" && FINAL.has(kind) ? { "x-should-retry": "false" } : {}),
      },
    })
  }

  // Поток SSE: сбой модели посреди ответа шлюз говорит своими словами — они переписываются.
  const clean = failed && type.includes("text/event-stream") ? scrubber(failed) : undefined
  const first = clean ? clean(rest) : rest
  let started = false
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!started) {
          started = true
          if (first.length > 0) return controller.enqueue(first)
        }
        const next = await iterator.next().catch((cause: unknown) => {
          controller.error(cause)
          return undefined
        })
        if (!next) return
        if (next.done) {
          const tail = clean?.()
          if (tail?.length) controller.enqueue(tail)
          return controller.close()
        }
        const value = clean ? clean(next.value) : next.value
        // Строка ещё не закончилась — ждём её конца в следующем куске.
        if (value.length > 0) controller.enqueue(value)
        else return this.pull?.(controller)
      },
      async cancel() {
        await iterator.return?.()
      },
    }),
    { status, headers: { "content-type": type } },
  )
}

/**
 * Сбой модели посреди потока (#966). Шлюз кладёт в SSE событие `data: {"error": {"message": …}}` со
 * своими словами («openai raised a streaming error…»). Вид события остаётся — по нему слой моделей
 * повторяет запрос, — а слова заменяются нашими. Всё остальное проходит байт в байт; границы
 * кусков произвольны, поэтому переписываются только законченные строки.
 */
function scrubber(failed: () => string): (chunk?: Uint8Array) => Uint8Array {
  let rest: Buffer = Buffer.alloc(0)
  return (chunk) => {
    const all = chunk ? Buffer.concat([rest, chunk]) : rest
    const end = chunk ? all.lastIndexOf(10) + 1 : all.length
    rest = all.subarray(end)
    const whole = all.subarray(0, end)
    if (!whole.includes('"error"')) return whole
    return Buffer.from(
      whole
        .toString("utf8")
        .split("\n")
        .map((line) => {
          if (!line.startsWith("data:") || !line.includes('"error"')) return line
          const event = parse(line.slice("data:".length))
          const error = event?.error
          if (!event || error === null || typeof error !== "object" || "choices" in event) return line
          return `data: ${JSON.stringify({ ...event, error: { ...error, message: failed() } })}`
        })
        .join("\n"),
      "utf8",
    )
  }
}

class SignedOut extends Error {}

/** Вид отказа в ответе с ошибкой. */
async function refusalType(reply: Response): Promise<string | undefined> {
  const kind = (parse(await reply.clone().text())?.error as Raw | undefined)?.type
  return typeof kind === "string" ? kind : undefined
}

/** `fetch` для провайдера подписки: тот же запрос, но командой через связь с сайтом аккаунта. */
export function fetcher(
  ports: Ports,
): (request: Request, signal?: AbortSignal, sized?: (bytes: number) => void) => Promise<Response> {
  return async (request, signal, sized) => {
    try {
      const { fields, bytes } = await read(request, sized)
      const { body: _whole, ...named } = fields
      const stop = signal ?? request.signal
      const limit = await ports.limit().catch(() => undefined)
      const limits = ports.limits()
      const token = (renew: boolean) =>
        ports.token(renew).catch((cause: unknown) => {
          throw new SignedOut(cause instanceof Error ? cause.message : String(cause))
        })
      const once = async (renew: boolean) => {
        const held = await token(renew)
        // Умещается в одно сообщение — идёт как есть; нет — тело уходит частями, вызов называет отправленное.
        if (BuffAccountUpload.fits(bytes.length, limit))
          return response(ports.stream({ ...fields, token: held, lang: ports.lang() }, stop), ports.failed)
        const sent = await BuffAccountUpload.send(
          { ask: (part) => ports.part({ ...part, lang: ports.lang() }), token },
          bytes,
          limit,
          stop,
          held,
          limits,
        )
        return response(
          ports.stream({ ...named, upload: sent.id, token: sent.token, lang: ports.lang() }, stop),
          ports.failed,
        )
      }
      const reply = await once(false)
      if (reply.status !== 401 || (await refusalType(reply)) !== "invalid_token") return reply
      // Токен не принят: один раз обновляем пару и повторяем. Не вышло — отказ как есть.
      // Вход завершён (устройство отозвано) — отказ словами причины.
      return await once(true).catch((cause: unknown) =>
        cause instanceof SignedOut ? refusal(401, "invalid_token", cause.message, true) : reply,
      )
    } catch (cause) {
      // Вход не действует (устройство отозвано, вход повреждён): повтор не поможет — словами причины.
      if (cause instanceof SignedOut) return refusal(401, "invalid_token", cause.message, true)
      // Больше, чем сервер принимает даже частями: повтор не поможет — сказать сразу.
      if (cause instanceof BuffAccountUpload.TooBig || cause instanceof BuffAccountLink.TooLarge)
        return refusal(413, "payload_too_large", ports.tooLarge(ports.limits().bodyMax), true)
      if (cause instanceof BuffAccountLink.Refused)
        return refusal(
          cause.retry ? 503 : 400,
          cause.retry ? "models_unavailable" : "refused",
          cause.message,
          !cause.retry,
        )
      // Связь оборвалась до ответа: это временно — общий порядок повторит запрос несколько раз.
      return refusal(503, "connection_lost", ports.lost(), false)
    }
  }
}

function parse(text: string): Raw | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : undefined
  } catch {
    return undefined
  }
}
