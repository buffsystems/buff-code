// Связь с сайтом аккаунта (#966): команды гостя, ответы и поток — на подменном соединении.
import { describe, expect, test } from "bun:test"
import { BuffAccountLink } from "../../src/buff/account/link"

type Sent = { subject: string; body: Record<string, unknown> }

/** Подменное соединение: помнит отправленное и даёт ответить на адрес ответа. */
function fake(maxPayload: number | null = 1_048_576) {
  const subs = new Map<string, (data: Uint8Array) => void>()
  const sent: Sent[] = []
  let closed!: () => void
  const state = { gids: [] as string[], closes: 0 }
  const conn: BuffAccountLink.Conn = {
    publish: (subject, data) => void sent.push({ subject, body: JSON.parse(Buffer.from(data).toString("utf8")) }),
    subscribe: (subject, onMessage) => {
      subs.set(subject, onMessage)
      return () => void subs.delete(subject)
    },
    maxPayload: () => maxPayload ?? undefined,
    close: async () => {
      state.closes++
      closed()
    },
    closed: new Promise<void>((resolve) => (closed = resolve)),
  }
  return {
    state,
    sent,
    subs,
    connect: async (gid: string) => (state.gids.push(gid), conn),
    /** Команды без служебных stream_ctl. */
    commands: () => sent.filter((item) => item.subject !== "data.cmd.stream_ctl"),
    controls: () => sent.filter((item) => item.subject === "data.cmd.stream_ctl").map(({ body }) => body),
    reply: (to: unknown, message: unknown) => subs.get(String(to))?.(Buffer.from(JSON.stringify(message), "utf8")),
    drop: () => closed(),
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64")
const id = "9f1c0000aaaa0001"

async function collect(stream: AsyncIterable<Uint8Array>) {
  const out: string[] = []
  for await (const piece of stream) out.push(Buffer.from(piece).toString("utf8"))
  return out
}

describe("команда с простым ответом", () => {
  test("гость публикует в data.cmd.<op> с адресом ответа в своём ящике", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect })
    const asked = link.ask("chat_usage", { token: "T", lang: "ru" })
    await tick()
    const [gid] = net.state.gids
    expect(gid).toMatch(/^[0-9a-f]{32}$/)
    const [command] = net.sent
    expect(command!.subject).toBe("data.cmd.chat_usage")
    expect(command!.body).toEqual({ op: "chat_usage", reply: `_INBOX.${gid}.1`, token: "T", lang: "ru" })
    net.reply(command!.body.reply, { ok: true, windows: [] })
    expect(await asked).toEqual({ ok: true, windows: [] })
    // Подписка на адрес ответа снята.
    expect(net.subs.size).toBe(0)
    await link.close()
  })

  test("одно соединение на все команды; у каждой свой адрес ответа", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect })
    const a = link.ask("chat_models", {})
    const b = link.ask("chat_usage", {})
    await tick()
    expect(net.state.gids).toHaveLength(1)
    const replies = net.sent.map((item) => item.body.reply)
    expect(new Set(replies).size).toBe(2)
    net.reply(replies[1], { ok: true, n: 2 })
    net.reply(replies[0], { ok: true, n: 1 })
    expect([await a, await b]).toEqual([
      { ok: true, n: 1 },
      { ok: true, n: 2 },
    ])
    await link.close()
  })

  test("большой ответ по кускам склеивается", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect })
    const asked = link.ask("chat_models", {})
    await tick()
    const reply = net.sent[0]!.body.reply
    const json = JSON.stringify({ ok: true, tiers: [{ id: "fast" }] })
    net.reply(reply, { chunk: { id: "a", seq: 0, of: 2 }, data: b64(json.slice(0, 9)) })
    net.reply(reply, { chunk: { id: "a", seq: 1, of: 2 }, data: b64(json.slice(9)) })
    expect(await asked).toEqual({ ok: true, tiers: [{ id: "fast" }] })
    await link.close()
  })

  test("отказ сервера — тоже ответ: слова остаются его", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect })
    const asked = link.ask("account_token", { code: "bufa_X", verifier: "v" })
    await tick()
    net.reply(net.sent[0]!.body.reply, {
      ok: false,
      error: "Код входа недействителен или истёк — начните вход заново.",
    })
    expect(await asked).toEqual({ ok: false, error: "Код входа недействителен или истёк — начните вход заново." })
    await link.close()
  })

  test("сервер молчит — обрыв по сроку, а не вечное ожидание", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect, replyMs: 20 })
    await expect(link.ask("chat_usage", {})).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    await link.close()
  })

  test("соединение закрылось — ждущая команда падает; следующая поднимает новое, под новым именем гостя", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect })
    const asked = link.ask("chat_usage", {})
    await tick()
    net.drop()
    await expect(asked).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    const second = fake()
    const again = BuffAccountLink.make({ connect: second.connect })
    void again.ask("chat_usage", {}).catch(() => undefined)
    await tick()
    expect(second.state.gids[0]).not.toBe(net.state.gids[0])
    await again.close()
  })

  test("не удалось подключиться — обрыв; следующая команда пробует заново", async () => {
    let attempts = 0
    const net = fake()
    const link = BuffAccountLink.make({
      connect: async (gid) => {
        if (++attempts === 1) throw new Error("no route")
        return net.connect(gid)
      },
    })
    await expect(link.ask("chat_usage", {})).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    const asked = link.ask("chat_usage", {})
    await tick()
    net.reply(net.sent[0]!.body.reply, { ok: true })
    expect(await asked).toEqual({ ok: true })
    await link.close()
  })

  test("в простое соединение закрывается, следующая команда поднимает его снова", async () => {
    const net = fake()
    const link = BuffAccountLink.make({ connect: net.connect, idleMs: 10 })
    const asked = link.ask("chat_usage", {})
    await tick()
    net.reply(net.sent[0]!.body.reply, { ok: true })
    await asked
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(net.state.closes).toBe(1)
    void link.ask("chat_usage", {}).catch(() => undefined)
    await tick()
    expect(net.state.gids).toHaveLength(2)
    await link.close()
  })
})

describe("предел размера", () => {
  test("команда больше max_payload не отправляется: ошибка с размером и пределом", async () => {
    const net = fake(1024)
    const link = BuffAccountLink.make({ connect: net.connect })
    const failure = await collect(link.stream("chat_model_call", { body: { text: "я".repeat(2000) } })).catch(
      (cause: unknown) => cause,
    )
    expect(failure).toBeInstanceOf(BuffAccountLink.TooLarge)
    expect((failure as BuffAccountLink.TooLarge).limit).toBe(1024)
    // Размер — в байтах сообщения, а не в знаках: русская буква занимает два.
    expect((failure as BuffAccountLink.TooLarge).bytes).toBeGreaterThan(4000)
    expect(net.sent).toEqual([])
    await link.close()
  })

  test("потолок команды — тот, что назвал сервер", async () => {
    const link = BuffAccountLink.make({ connect: fake(1_048_576).connect })
    expect(await link.limit()).toBe(1_048_576)
    await link.close()
    const silent = BuffAccountLink.make({ connect: fake(null).connect })
    expect(await silent.limit()).toBeUndefined()
    await silent.close()
  })

  test("ровно в пределе — отправляется", async () => {
    const probe = fake()
    const sizing = BuffAccountLink.make({ connect: probe.connect })
    void sizing.ask("x", { pad: "" }).catch(() => undefined)
    await tick()
    const base = Buffer.byteLength(JSON.stringify(probe.sent[0]!.body))
    await sizing.close()
    const net = fake(base + 10)
    const link = BuffAccountLink.make({ connect: net.connect })
    void link.ask("x", { pad: "a".repeat(10) }).catch(() => undefined)
    await tick()
    expect(net.sent).toHaveLength(1)
    await link.close()
  })
})

describe("поток", () => {
  const start = async (
    net: ReturnType<typeof fake>,
    options: Partial<BuffAccountLink.Options> = {},
    signal?: AbortSignal,
  ) => {
    const link = BuffAccountLink.make({ connect: net.connect, ...options })
    const reading = collect(link.stream("chat_model_call", { tier: "fast" }, signal))
    // Не дать необработанному отказу уронить тест до проверки.
    reading.catch(() => undefined)
    await tick()
    return { link, reading, reply: net.commands()[0]!.body.reply }
  }

  test("куски по порядку до конца; конец подтверждается", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net)
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    net.reply(reply, { chunk: { id, beat: true } })
    net.reply(reply, { chunk: { id, seq: 1 }, data: b64("b") })
    net.reply(reply, { chunk: { id, seq: 2, last: true } })
    expect(await reading).toEqual(["a", "b"])
    const [gid] = net.state.gids
    expect(net.controls()).toEqual([{ op: "stream_ctl", reply: `_INBOX.${gid}.ctl`, id, ack: 2 }])
    await link.close()
  })

  test("пропуск куска — просьба повторить; после повтора данные целы", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net)
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    net.reply(reply, { chunk: { id, seq: 2 }, data: b64("c") })
    await tick()
    expect(net.controls()).toEqual([expect.objectContaining({ id, resume: 1 })])
    net.reply(reply, { chunk: { id, seq: 1 }, data: b64("b") })
    net.reply(reply, { chunk: { id, seq: 2 }, data: b64("c") })
    net.reply(reply, { chunk: { id, seq: 3, last: true } })
    expect(await reading).toEqual(["a", "b", "c"])
    await link.close()
  })

  test("сервер оборвал поток — его словами", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net)
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    net.reply(reply, { chunk: { id, seq: 1, error: "читатель не забирает поток — остановлено" } })
    await expect(reading).rejects.toThrow("читатель не забирает поток — остановлено")
    await link.close()
  })

  test("простой отказ вместо потока", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net)
    net.reply(reply, { ok: false, error: "token required" })
    const failure = await reading.catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(BuffAccountLink.Refused)
    expect((failure as BuffAccountLink.Refused).message).toBe("token required")
    expect((failure as BuffAccountLink.Refused).retry).toBe(false)
    await link.close()
  })

  test("сбой сервера помечен как повторяемый", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net)
    net.reply(reply, { ok: false, error: "internal error", retry: true })
    expect(((await reading.catch((cause: unknown) => cause)) as BuffAccountLink.Refused).retry).toBe(true)
    await link.close()
  })

  test("тишина: один раз просим повторить, потом связь мертва — и серверу уходит отмена", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net, { silenceMs: 20 })
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    await expect(reading).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    expect(net.controls().map(({ resume, cancel }) => ({ resume, cancel }))).toEqual([
      { resume: 1, cancel: undefined },
      { resume: undefined, cancel: true },
    ])
    await link.close()
  })

  test("сигнал «жив» — не тишина: думающая модель не считается мёртвой связью", async () => {
    const net = fake()
    const { link, reading, reply } = await start(net, { silenceMs: 30 })
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    for (let beat = 0; beat < 4; beat++) {
      await new Promise((resolve) => setTimeout(resolve, 15))
      net.reply(reply, { chunk: { id, beat: true } })
    }
    net.reply(reply, { chunk: { id, seq: 1, last: true } })
    expect(await reading).toEqual(["a"])
    expect(net.controls().some((body) => "resume" in body)).toBe(false)
    await link.close()
  })

  test("ни одного кадра — обрыв после двух сроков тишины", async () => {
    const net = fake()
    const { link, reading } = await start(net, { silenceMs: 10 })
    await expect(reading).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    await link.close()
  })

  test("соединение закрылось посреди потока — обрыв", async () => {
    const net = fake()
    const { reading, reply } = await start(net)
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    await tick()
    net.drop()
    await expect(reading).rejects.toBeInstanceOf(BuffAccountLink.Cut)
  })

  test("человек остановил ответ — серверу уходит отмена", async () => {
    const net = fake()
    const abort = new AbortController()
    const { link, reading, reply } = await start(net, {}, abort.signal)
    net.reply(reply, { chunk: { id, seq: 0 }, data: b64("a") })
    await tick()
    abort.abort()
    await expect(reading).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    expect(net.controls()).toEqual([expect.objectContaining({ id, cancel: true })])
    expect(net.subs.size).toBe(0)
    await link.close()
  })
})
