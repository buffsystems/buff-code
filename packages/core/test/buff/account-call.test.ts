// Вызов модели подписки (#966): HTTP-запрос → команда, записанные кадры потока → ответ HTTP.
import { describe, expect, test } from "bun:test"
import { BuffAccountCall } from "../../src/buff/account/call"
import { BuffAccountLink } from "../../src/buff/account/link"
import { BuffAccountUpload } from "../../src/buff/account/upload"

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"))
async function* pieces(...texts: string[]) {
  for (const text of texts) yield bytes(text)
}

const request = (body: unknown, headers: Record<string, string> = {}, path = "/v1/chat/completions") =>
  new Request(`https://account.invalid${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer ignored", ...headers },
    body: JSON.stringify(body),
  })

describe("запрос → команда chat_model_call", () => {
  test("уровень — из model, путь — после /v1/, тело — как есть, метки расхода — из заголовков", async () => {
    const body = { model: "optimal", stream: true, messages: [{ role: "user", content: "привет" }] }
    expect(
      await BuffAccountCall.command(
        request(body, { "X-Buff-Session": "ses_1", "X-Buff-Message": "msg_1", "X-Buff-Call": "primary" }),
      ),
    ).toEqual({ tier: "optimal", path: "chat/completions", body, session: "ses_1", message: "msg_1", call: "primary" })
  })

  test("путь responses; служебный вызов без сообщения", async () => {
    expect(
      await BuffAccountCall.command(
        request({ model: "fast", input: "x" }, { "X-Buff-Session": "ses_1", "X-Buff-Call": "title" }, "/v1/responses"),
      ),
    ).toEqual({ tier: "fast", path: "responses", body: { model: "fast", input: "x" }, session: "ses_1", call: "title" })
  })
})

describe("кадры → ответ HTTP", () => {
  test("пример из контракта: SSE проходит как есть, байт в байт", async () => {
    const sse = [
      'data: {"model":"optimal","choices":[{"delta":{"content":"при"}}]}\n\n',
      'data: {"model":"optimal","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    ]
    const reply = await BuffAccountCall.response(pieces('{"status":200,"content_type":"text/event-stream"}\n', ...sse))
    expect(reply.status).toBe(200)
    expect(reply.headers.get("content-type")).toBe("text/event-stream")
    expect(await reply.text()).toBe(sse.join(""))
  })

  // Записано на стенде: шлюз оборвал поток посреди ответа и сказал об этом своими словами прямо в SSE.
  const RAW =
    "litellm.APIError: APIError: OpenAIException - openai raised a streaming error - finish_reason: error, no content string given. Received Chunk={'text': '', 'is_finished': True, 'finish_reason': 'error', 'logprobs': None, 'original_chunk': ChatCompletionChunk(id='gen-1', choices=[Choice(delta=ChoiceDelta(content=''))])}"
  const failure = `data: ${JSON.stringify({ error: { message: RAW, type: null, param: null, code: "500" } })}\n\n`

  test("сбой модели посреди потока: слова шлюза человеку не уходят, остальное цело байт в байт", async () => {
    const before = 'data: {"model":"optimal","choices":[{"delta":{"content":"при"}}]}\n\n'
    const reply = await BuffAccountCall.response(
      pieces('{"status":200,"content_type":"text/event-stream; charset=utf-8"}\n', before, failure, "data: [DONE]\n\n"),
      () => "Модель не смогла ответить.",
    )
    const text = await reply.text()
    expect(text.startsWith(before)).toBe(true)
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
    expect(text).not.toContain("openai")
    expect(text).not.toContain("litellm")
    const event = JSON.parse(text.slice(before.length).split("\n")[0]!.slice("data: ".length))
    // Вид события прежний — слой моделей узнаёт в нём сбой и повторяет запрос сам.
    expect(event).toEqual({ error: { message: "Модель не смогла ответить.", type: null, param: null, code: "500" } })
  })

  test("событие сбоя разрезано границами кусков — всё равно переписывается", async () => {
    const bytes = Buffer.from(failure, "utf8")
    async function* split() {
      yield new Uint8Array(Buffer.from('{"status":200,"content_type":"text/event-stream"}\n', "utf8"))
      yield new Uint8Array(bytes.subarray(0, 40))
      yield new Uint8Array(bytes.subarray(40, 200))
      yield new Uint8Array(bytes.subarray(200))
    }
    const text = await (await BuffAccountCall.response(split(), () => "Модель не смогла ответить.")).text()
    expect(text).toBe(
      `data: ${JSON.stringify({ error: { message: "Модель не смогла ответить.", type: null, param: null, code: "500" } })}\n\n`,
    )
  })

  test("слово «error» в самом ответе модели — не сбой: текст ответа не трогается", async () => {
    const answer = 'data: {"model":"fast","choices":[{"delta":{"content":"the \\"error\\" field"}}]}\n\n'
    const reply = await BuffAccountCall.response(
      pieces('{"status":200,"content_type":"text/event-stream"}\n', answer),
      () => "x",
    )
    expect(await reply.text()).toBe(answer)
  })

  test("строка статуса кончается посреди куска, а буква разрезана границей — тело цело", async () => {
    const payload = Buffer.from(
      '{"status":200,"content_type":"application/json"}\n{"choices":[{"message":{"content":"привет"}}]}',
      "utf8",
    )
    const cut = payload.indexOf(Buffer.from("п")) + 1
    async function* split() {
      yield new Uint8Array(payload.subarray(0, 10))
      yield new Uint8Array(payload.subarray(10, cut))
      yield new Uint8Array(payload.subarray(cut))
    }
    const reply = await BuffAccountCall.response(split())
    expect(await reply.json()).toEqual({ choices: [{ message: { content: "привет" } }] })
  })

  const refusals: Array<[number, string, string]> = [
    [402, "no_subscription", "Нет действующей подписки — модели недоступны."],
    [
      402,
      "subscription_readonly",
      "Подписка закончилась: идёт срок чтения, модели выключены. Продлите подписку, чтобы продолжить.",
    ],
    [403, "subscription_blocked", "Доступ к чату остановлен. Напишите в поддержку."],
    [
      422,
      "budget_exceeded",
      "Лимит подписки исчерпан. Сколько использовано и когда лимит обновится — в разделе «Расход».",
    ],
    [429, "rate_limit_exceeded", "Превышен лимит запросов к модели по вашему тарифу. Повторите через 12 с."],
    [404, "unknown_tier", "Такой уровень модели недоступен."],
  ]
  for (const [status, type, message] of refusals)
    test(`отказ ${status} ${type}: слова сервера, повторять нельзя`, async () => {
      const reply = await BuffAccountCall.response(
        pieces(
          `{"status":${status},"content_type":"application/json"}\n`,
          JSON.stringify({ error: { message, type, code: status } }),
        ),
      )
      expect(reply.status).toBe(status)
      expect(reply.headers.get("x-should-retry")).toBe("false")
      expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(message)
    })

  test("временный отказ (модели недоступны, ошибка модели) повторять можно", async () => {
    for (const [status, type] of [
      [503, "models_unavailable"],
      [500, "model_error"],
    ] as const) {
      const reply = await BuffAccountCall.response(
        pieces(
          `{"status":${status},"content_type":"application/json"}\n{"error":{"message":"x","type":"${type}","code":${status}}}`,
        ),
      )
      expect(reply.status).toBe(status)
      expect(reply.headers.has("x-should-retry")).toBe(false)
    }
  })

  test("поток кончился до строки статуса или без неё — обрыв, а не пустой ответ", async () => {
    await expect(BuffAccountCall.response(pieces())).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    await expect(BuffAccountCall.response(pieces('{"status":20'))).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    await expect(BuffAccountCall.response(pieces("not json\nbody"))).rejects.toBeInstanceOf(BuffAccountLink.Cut)
  })

  test("связь оборвалась посреди ответа — чтение тела падает, начало уже отдано", async () => {
    async function* cut() {
      yield bytes('{"status":200,"content_type":"text/event-stream"}\ndata: {"a":1}\n\n')
      throw new BuffAccountLink.Cut("connection closed")
    }
    const reply = await BuffAccountCall.response(cut())
    const reader = reply.body!.getReader()
    expect(Buffer.from((await reader.read()).value!).toString("utf8")).toBe('data: {"a":1}\n\n')
    await expect(reader.read()).rejects.toThrow("connection closed")
  })

  test("читатель бросил ответ — поток кусков закрывается (серверу уйдёт отмена)", async () => {
    let closed = false
    async function* endless() {
      try {
        yield bytes('{"status":200,"content_type":"text/event-stream"}\n')
        while (true) yield bytes("data: {}\n\n")
      } finally {
        closed = true
      }
    }
    const reply = await BuffAccountCall.response(endless())
    const reader = reply.body!.getReader()
    await reader.read()
    await reader.cancel()
    expect(closed).toBe(true)
  })
})

describe("fetch провайдера подписки", () => {
  const ok = () => pieces('{"status":200,"content_type":"application/json"}\n{"ok":1}')
  const unauthorized = (message = "token expired") =>
    pieces(
      `{"status":401,"content_type":"application/json"}\n{"error":{"message":"${message}","type":"invalid_token","code":401}}`,
    )
  const ports = (over: Partial<BuffAccountCall.Ports>): BuffAccountCall.Ports => ({
    token: async (renew) => (renew ? "fresh" : "kept"),
    stream: ok,
    lang: () => "ru",
    part: async () => ({ ok: true }),
    limit: async () => 1_048_576,
    limits: () => ({ ...BuffAccountUpload.DEFAULTS, named: true }),
    tooLarge: (limit) => `запрос слишком большой (максимум ${limit / 1_048_576} МБ)`,
    lost: () => "связь с Buff оборвалась",
    failed: () => "Модель не смогла ответить.",
    ...over,
  })

  test("команда несёт токен и язык; ответ — от сервера", async () => {
    const seen: unknown[] = []
    const fetch = BuffAccountCall.fetcher(ports({ stream: (fields) => (seen.push(fields), ok()) }))
    const reply = await fetch(request({ model: "fast", messages: [] }))
    expect(await reply.json()).toEqual({ ok: 1 })
    expect(seen).toEqual([
      { tier: "fast", path: "chat/completions", body: { model: "fast", messages: [] }, token: "kept", lang: "ru" },
    ])
  })

  test("токен не принят — один раз обновляем и повторяем", async () => {
    const tokens: unknown[] = []
    const fetch = BuffAccountCall.fetcher(
      ports({ stream: (fields) => (tokens.push(fields.token), fields.token === "fresh" ? ok() : unauthorized()) }),
    )
    expect((await fetch(request({ model: "fast" }))).status).toBe(200)
    expect(tokens).toEqual(["kept", "fresh"])
  })

  test("и с обновлённым токеном отказ — больше не повторяем, отказ словами сервера", async () => {
    let calls = 0
    const fetch = BuffAccountCall.fetcher(
      ports({ stream: () => (calls++, unauthorized("Устройство отозвано — войдите заново.")) }),
    )
    const reply = await fetch(request({ model: "fast" }))
    expect(calls).toBe(2)
    expect(reply.status).toBe(401)
    expect(reply.headers.get("x-should-retry")).toBe("false")
    expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(
      "Устройство отозвано — войдите заново.",
    )
  })

  test("обновление отказано — отказ словами этой причины", async () => {
    const fetch = BuffAccountCall.fetcher(
      ports({
        token: async (renew) => {
          if (renew) throw new Error("Устройство отозвано — войдите заново.")
          return "kept"
        },
        stream: () => unauthorized(),
      }),
    )
    const reply = await fetch(request({ model: "fast" }))
    expect(reply.status).toBe(401)
    // Причина — та, с которой отказано обновление: по ней человек понимает, что делать.
    expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(
      "Устройство отозвано — войдите заново.",
    )
  })

  test("входа нет вовсе — отказ словами причины, без повторов", async () => {
    const fetch = BuffAccountCall.fetcher(
      ports({ token: async () => Promise.reject(new Error("Вход повреждён — войдите заново.")) }),
    )
    const reply = await fetch(request({ model: "fast" }))
    expect(reply.status).toBe(401)
    expect(reply.headers.get("x-should-retry")).toBe("false")
    expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(
      "Вход повреждён — войдите заново.",
    )
  })

  /** Сервер частей: помнит принятое тело. */
  const parts = () => {
    const calls: Array<Record<string, unknown>> = []
    const held: string[] = []
    return {
      calls,
      body: () => Buffer.concat(held.map((data) => Buffer.from(data, "base64"))).toString("utf8"),
      part: async (fields: Record<string, unknown>) => {
        calls.push(fields)
        const chunk = fields.chunk as { seq: number; of: number }
        if (chunk.seq === held.length) held.push(String(fields.data))
        return { ok: true, received: held.length, of: chunk.of }
      },
      reset: () => void held.splice(0),
    }
  }
  const big = { model: "optimal", stream: true, messages: [{ role: "user", content: "я".repeat(900_000) }] }

  test("запрос, который не умещается в сообщение, уходит частями; вызов называет отправленное вместо тела", async () => {
    const net = parts()
    const streamed: Array<Record<string, unknown>> = []
    const fetch = BuffAccountCall.fetcher(ports({ part: net.part, stream: (fields) => (streamed.push(fields), ok()) }))
    const reply = await fetch(request(big, { "X-Buff-Session": "ses_1", "X-Buff-Call": "primary" }))
    expect(reply.status).toBe(200)
    // 1,8 МБ тела — три части по 720 000 байт, каждая со своим токеном и языком.
    expect(net.calls.map((call) => call.chunk)).toMatchObject([
      { seq: 0, of: 3 },
      { seq: 1, of: 3 },
      { seq: 2, of: 3 },
    ])
    expect(net.calls.every((call) => call.token === "kept" && call.lang === "ru")).toBe(true)
    expect(net.body()).toBe(JSON.stringify(big))
    const id = (net.calls[0]!.chunk as { id: string }).id
    expect(streamed).toEqual([
      {
        tier: "optimal",
        path: "chat/completions",
        session: "ses_1",
        call: "primary",
        upload: id,
        token: "kept",
        lang: "ru",
      },
    ])
  })

  test("запрос, который умещается, идёт одним сообщением — частей нет", async () => {
    const net = parts()
    const fetch = BuffAccountCall.fetcher(ports({ part: net.part }))
    await fetch(request({ model: "fast", messages: [{ role: "user", content: "x".repeat(500_000) }] }))
    expect(net.calls).toEqual([])
  })

  test("токен не принят закрывающим вызовом — отправка повторяется целиком, под новым идентификатором", async () => {
    const net = parts()
    const uploads: unknown[] = []
    const fetch = BuffAccountCall.fetcher(
      ports({
        part: net.part,
        stream: (fields) => {
          uploads.push(fields.upload)
          net.reset()
          return fields.token === "fresh" ? ok() : unauthorized()
        },
      }),
    )
    expect((await fetch(request(big))).status).toBe(200)
    expect(net.calls).toHaveLength(6)
    expect(new Set(uploads).size).toBe(2)
  })

  test("сервер пределов не назвал — и большой запрос уходит частями: откажет, если что, он сам", async () => {
    const net = parts()
    const fetch = BuffAccountCall.fetcher(ports({ part: net.part, limits: () => BuffAccountUpload.DEFAULTS }))
    const reply = await fetch(
      request({ model: "optimal", messages: [{ role: "user", content: "x".repeat(16 * 1_048_576) }] }),
    )
    expect(reply.status).toBe(200)
    expect(net.calls).toHaveLength(24)
  })

  test("тело больше названного сервером потолка — понятный отказ сразу: ни одной части не уходит", async () => {
    const net = parts()
    let streamed = 0
    const fetch = BuffAccountCall.fetcher(ports({ part: net.part, stream: () => (streamed++, ok()) }))
    const reply = await fetch(
      request({ model: "optimal", messages: [{ role: "user", content: "x".repeat(16 * 1_048_576) }] }),
    )
    expect(reply.status).toBe(413)
    expect(reply.headers.get("x-should-retry")).toBe("false")
    expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(
      "запрос слишком большой (максимум 16 МБ)",
    )
    expect(net.calls).toEqual([])
    expect(streamed).toBe(0)
  })

  for (const error of [
    "Запрос к модели не дошёл целиком: его части устарели. Отправьте запрос ещё раз.",
    "Слишком много больших запросов одновременно. Дождитесь ответа на предыдущие и повторите.",
  ])
    test(`часть отклонена («${error.slice(0, 32)}…») — слова сервера, без повторов и без вызова модели`, async () => {
      let streamed = 0
      let asked = 0
      const fetch = BuffAccountCall.fetcher(
        ports({ part: async () => (asked++, { ok: false, error }), stream: () => (streamed++, ok()) }),
      )
      const reply = await fetch(request(big))
      expect(reply.status).toBe(400)
      expect(reply.headers.get("x-should-retry")).toBe("false")
      expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(error)
      expect(asked).toBe(1)
      expect(streamed).toBe(0)
    })

  for (const [type, message] of [
    ["upload_expired", "Запрос к модели не дошёл целиком: его части устарели. Отправьте запрос ещё раз."],
    ["upload_incomplete", "Запрос к модели пришёл не полностью. Отправьте запрос ещё раз."],
  ] as const)
    test(`закрывающий вызов отклонён (${type}) — слова сервера, повторять нельзя`, async () => {
      const net = parts()
      const fetch = BuffAccountCall.fetcher(
        ports({
          part: net.part,
          stream: () =>
            pieces(
              '{"status":400,"content_type":"application/json"}\n',
              JSON.stringify({ error: { message, type, code: 400 } }),
            ),
        }),
      )
      const reply = await fetch(request(big))
      expect(reply.status).toBe(400)
      expect(reply.headers.get("x-should-retry")).toBe("false")
      expect(((await reply.json()) as { error: { message: string } }).error.message).toBe(message)
    })

  test("остановка человеком посреди отправки — оставшиеся части не уходят, модель не зовётся", async () => {
    const abort = new AbortController()
    let streamed = 0
    let asked = 0
    const fetch = BuffAccountCall.fetcher(
      ports({
        part: async (fields) => {
          asked++
          abort.abort()
          return { ok: true, received: (fields.chunk as { seq: number }).seq + 1 }
        },
        stream: () => (streamed++, ok()),
      }),
    )
    await fetch(request(big), abort.signal)
    expect(asked).toBe(1)
    expect(streamed).toBe(0)
  })

  test("простой отказ вместо потока — словами сервера; сбой сервера можно повторить", async () => {
    const refused = (retry: boolean) =>
      BuffAccountCall.fetcher(
        ports({
          // eslint-disable-next-line require-yield
          stream: async function* () {
            throw new BuffAccountLink.Refused(
              retry ? "internal error" : "Эта возможность недоступна в вашем издании.",
              retry,
            )
          },
        }),
      )(request({ model: "fast" }))
    const final = await refused(false)
    expect(final.status).toBe(400)
    expect(final.headers.get("x-should-retry")).toBe("false")
    expect(((await final.json()) as { error: { message: string } }).error.message).toBe(
      "Эта возможность недоступна в вашем издании.",
    )
    const transient = await refused(true)
    expect(transient.status).toBe(503)
    expect(transient.headers.has("x-should-retry")).toBe(false)
  })

  test("обрыв связи до ответа — временный отказ словами для человека (общий порядок повторит)", async () => {
    const fetch = BuffAccountCall.fetcher(
      ports({
        // eslint-disable-next-line require-yield
        stream: async function* () {
          throw new BuffAccountLink.Cut("connection closed")
        },
      }),
    )
    const reply = await fetch(request({ model: "fast" }))
    expect(reply.status).toBe(503)
    expect(reply.headers.has("x-should-retry")).toBe(false)
    expect(((await reply.json()) as { error: { message: string } }).error.message).toBe("связь с Buff оборвалась")
  })

  test("размер тела запроса сообщается в байтах — по нему видно, как близко потолок команды", async () => {
    let bytes = 0
    const body = { model: "fast", messages: [{ role: "user", content: "привет" }] }
    await BuffAccountCall.fetcher(ports({}))(request(body), undefined, (size) => (bytes = size))
    expect(bytes).toBe(Buffer.byteLength(JSON.stringify(body)))
  })

  test("остановка ответа человеком доходит до потока", async () => {
    const abort = new AbortController()
    let seen: AbortSignal | undefined
    const fetch = BuffAccountCall.fetcher(ports({ stream: (_fields, signal) => ((seen = signal), ok()) }))
    await fetch(request({ model: "fast" }), abort.signal)
    expect(seen).toBe(abort.signal)
  })
})
