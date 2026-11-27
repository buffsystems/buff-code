// Большой запрос к модели (#966): тело уходит частями — как оно режется и что делать с отказами.
import { describe, expect, test } from "bun:test"
import { BuffAccountLink } from "../../src/buff/account/link"
import { BuffAccountUpload } from "../../src/buff/account/upload"

type Raw = Record<string, unknown>
const MIB = 1_048_576

describe("умещается ли запрос в одно сообщение", () => {
  test("тело с запасом на конверт — в пределах потолка сервера", () => {
    expect(BuffAccountUpload.fits(100_000, MIB)).toBe(true)
    expect(BuffAccountUpload.fits(MIB - 4096, MIB)).toBe(true)
    expect(BuffAccountUpload.fits(MIB - 4095, MIB)).toBe(false)
    expect(BuffAccountUpload.fits(5 * MIB, MIB)).toBe(false)
  })
  test("сервер потолка не назвал — шлём целиком", () => {
    expect(BuffAccountUpload.fits(5 * MIB, undefined)).toBe(true)
  })
})

const named = (over: Partial<BuffAccountUpload.Limits> = {}): BuffAccountUpload.Limits => ({
  ...BuffAccountUpload.DEFAULTS,
  named: true,
  ...over,
})

describe("размер части", () => {
  test("пока сервер пределов не назвал — значения контракта: 720 000 байт тела при потолке сообщения в 1 МБ", () => {
    expect(BuffAccountUpload.DEFAULTS).toEqual({ bodyMax: 16 * MIB, pieceMax: 720_000, piecesMax: 64, named: false })
    expect(BuffAccountUpload.pieceSize(MIB)).toBe(720_000)
    expect(BuffAccountUpload.pieceSize(undefined)).toBe(720_000)
    expect(BuffAccountUpload.pieceSize(8 * MIB)).toBe(720_000)
  })
  test("потолок сообщения соединения меньше — часть меньше, кратна трём", () => {
    const size = BuffAccountUpload.pieceSize(65_536)
    expect(size).toBe(46_080)
    expect(size % 3).toBe(0)
  })
  test("оператор задал свою часть — берётся она, но не больше, чем пропустит соединение", () => {
    expect(BuffAccountUpload.pieceSize(MIB, named({ pieceMax: 300_000 }))).toBe(300_000)
    expect(BuffAccountUpload.pieceSize(MIB, named({ pieceMax: 300_001 }))).toBe(300_000)
    expect(BuffAccountUpload.pieceSize(MIB, named({ pieceMax: 3_000_000 }))).toBe(783_360)
    expect(BuffAccountUpload.pieceSize(4 * MIB, named({ pieceMax: 3_000_000 }))).toBe(3_000_000)
  })
})

describe("пределы установки", () => {
  test("сервер назвал — берутся его; не назвал — значения контракта, и они не считаются названными", () => {
    expect(BuffAccountUpload.limits({ maxBytes: 8 * MIB, pieceBytes: 783_360, maxPieces: 32 })).toEqual({
      bodyMax: 8 * MIB,
      pieceMax: 783_360,
      piecesMax: 32,
      named: true,
    })
    expect(BuffAccountUpload.limits(undefined)).toBe(BuffAccountUpload.DEFAULTS)
  })
  test("часть сервера в 783 360 байт умещается в сообщение в 1 МБ", () => {
    const named = BuffAccountUpload.limits({ maxBytes: 16 * MIB, pieceBytes: 783_360, maxPieces: 64 })
    expect(BuffAccountUpload.pieceSize(MIB, named)).toBe(783_360)
    expect(BuffAccountUpload.plan(3_918_034, MIB, named)).toEqual({ size: 783_360, of: 6 })
  })
})

describe("план частей", () => {
  test("пример из контракта: 3 601 234 байта — шесть частей", () => {
    expect(BuffAccountUpload.plan(3_601_234, MIB)).toEqual({ size: 720_000, of: 6 })
  })
  test("ровно в часть — одна; на байт больше — две", () => {
    expect(BuffAccountUpload.plan(720_000, MIB)).toEqual({ size: 720_000, of: 1 })
    expect(BuffAccountUpload.plan(720_001, MIB)).toEqual({ size: 720_000, of: 2 })
  })
  test("сервер назвал пределы — больше потолка тела или числа частей не отправляется вовсе", () => {
    expect(BuffAccountUpload.plan(16 * MIB, MIB, named())).toEqual({ size: 720_000, of: 24 })
    expect(BuffAccountUpload.plan(16 * MIB + 1, MIB, named())).toBeUndefined()
    expect(BuffAccountUpload.plan(46_080 * 64 + 1, 65_536, named())).toBeUndefined()
    // У другой установки пределы свои.
    expect(BuffAccountUpload.plan(40 * MIB, MIB, named({ bodyMax: 64 * MIB, piecesMax: 128 }))).toEqual({
      size: 720_000,
      of: 59,
    })
    expect(BuffAccountUpload.plan(4 * MIB + 1, MIB, named({ bodyMax: 4 * MIB }))).toBeUndefined()
  })
  test("пределы не названы — значения контракта лишь ориентир: режем, а откажет сам сервер", () => {
    expect(BuffAccountUpload.plan(16 * MIB + 1, MIB)).toEqual({ size: 720_000, of: 24 })
    expect(BuffAccountUpload.plan(46_080 * 64 + 1, 65_536)).toEqual({ size: 46_080, of: 65 })
  })
})

/** Сервер частей: помнит принятое и отвечает по контракту; `script` подменяет ответ на очередной вызов. */
function server(script: Array<Raw | Error | undefined> = []) {
  const calls: Raw[] = []
  const held: string[] = []
  return {
    calls,
    body: () => Buffer.concat(held.map((data) => Buffer.from(data, "base64"))),
    ask: async (fields: Raw): Promise<Raw> => {
      calls.push(fields)
      const scripted = script.shift()
      if (scripted instanceof Error) throw scripted
      if (scripted) return scripted
      const chunk = fields.chunk as { seq: number; of: number }
      if (chunk.seq === held.length) held.push(String(fields.data))
      return { ok: true, received: held.length, of: chunk.of }
    },
  }
}

const body = (bytes: number) => Buffer.from(`{"t":"${"я".repeat(Math.floor((bytes - 8) / 2))}"}`, "utf8")
const ports = (
  net: ReturnType<typeof server>,
  over: Partial<BuffAccountUpload.Ports> = {},
): BuffAccountUpload.Ports => ({
  ask: net.ask,
  token: async (renew) => (renew ? "fresh" : "kept"),
  id: () => "u_test0001",
  pause: async () => undefined,
  ...over,
})

describe("отправка частями", () => {
  test("части идут по порядку, по одной; склеенное на сервере равно телу байт в байт", async () => {
    const net = server()
    const bytes = body(100_000)
    const sent = await BuffAccountUpload.send(ports(net), bytes, 65_536)
    expect(sent).toEqual({ id: "u_test0001", token: "kept" })
    expect(net.calls.map((call) => call.chunk)).toEqual([
      { id: "u_test0001", seq: 0, of: 3 },
      { id: "u_test0001", seq: 1, of: 3 },
      { id: "u_test0001", seq: 2, of: 3 },
    ])
    expect(net.calls.every((call) => call.token === "kept")).toBe(true)
    // Каждая часть — свой base64 с дополнением; граница режет букву, а тело цело.
    expect(net.calls.every((call) => String(call.data).length % 4 === 0)).toBe(true)
    expect(net.body().equals(bytes)).toBe(true)
  })

  test("идентификатор каждый раз новый и подходит серверу", () => {
    const id = BuffAccountUpload.uploadID()
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(BuffAccountUpload.uploadID()).not.toBe(id)
  })

  test("ответ на часть потерялся — та же часть шлётся снова, сервер не считает её дважды", async () => {
    const net = server([undefined, new BuffAccountLink.Cut("no reply")])
    const bytes = body(100_000)
    await BuffAccountUpload.send(ports(net), bytes, 65_536)
    expect(net.calls.map((call) => (call.chunk as { seq: number }).seq)).toEqual([0, 1, 1, 2])
    expect(net.body().equals(bytes)).toBe(true)
  })

  test("связь не возвращается — обрыв, а не вечные повторы", async () => {
    const cut = () => new BuffAccountLink.Cut("no reply")
    const net = server([cut(), cut(), cut(), cut()])
    await expect(BuffAccountUpload.send(ports(net), body(100_000), 65_536)).rejects.toBeInstanceOf(BuffAccountLink.Cut)
    expect(net.calls).toHaveLength(3)
  })

  test("токен истёк посреди отправки — обновляем и продолжаем с той же части", async () => {
    const net = server([undefined, { ok: false, error: "token expired" }])
    const bytes = body(100_000)
    const sent = await BuffAccountUpload.send(ports(net), bytes, 65_536)
    expect(net.calls.map((call) => [(call.chunk as { seq: number }).seq, call.token])).toEqual([
      [0, "kept"],
      [1, "kept"],
      [1, "fresh"],
      [2, "fresh"],
    ])
    // Закрывающий вызов пойдёт с новым токеном.
    expect(sent.token).toBe("fresh")
    expect(net.body().equals(bytes)).toBe(true)
  })

  test("токен истёк и после обновления — отказ, без круга", async () => {
    const expired = { ok: false, error: "token expired" }
    const net = server([expired, expired])
    const failure = await BuffAccountUpload.send(ports(net), body(100_000), 65_536).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(BuffAccountLink.Refused)
    expect(net.calls).toHaveLength(2)
  })

  test("хранилище занято — та же часть повторяется несколько раз, потом отказ словами сервера", async () => {
    const busy = { ok: false, error: "модели сейчас недоступны" }
    const net = server([busy, busy])
    await BuffAccountUpload.send(ports(net), body(50_000), 65_536)
    expect(net.calls.map((call) => (call.chunk as { seq: number }).seq)).toEqual([0, 0, 0, 1])
    const stuck = server([busy, busy, busy, busy, busy])
    const failure = await BuffAccountUpload.send(ports(stuck), body(50_000), 65_536).catch((cause: unknown) => cause)
    expect((failure as Error).message).toBe("модели сейчас недоступны")
    expect((failure as BuffAccountLink.Refused).retry).toBe(true)
    expect(stuck.calls).toHaveLength(4)
  })

  const refusals = [
    "Запрос к модели слишком большой (максимум 16 МБ). Сократите контекст или уберите часть вложений.",
    "Запрос к модели не дошёл целиком: его части устарели. Отправьте запрос ещё раз.",
    "Слишком много больших запросов одновременно. Дождитесь ответа на предыдущие и повторите.",
    "Некорректная часть запроса к модели.",
    "Устройство отозвано — войдите заново.",
  ]
  for (const error of refusals)
    test(`отказ сервера «${error.slice(0, 40)}…» — его словами, отправка прекращается`, async () => {
      const net = server([undefined, { ok: false, error }])
      const failure = await BuffAccountUpload.send(ports(net), body(100_000), 65_536).catch((cause: unknown) => cause)
      expect(failure).toBeInstanceOf(BuffAccountLink.Refused)
      expect((failure as Error).message).toBe(error)
      expect((failure as BuffAccountLink.Refused).retry).toBe(false)
      expect(net.calls).toHaveLength(2)
    })

  test("сервер ждёт другую часть («не по порядку») — шлём ту, которую он назвал", async () => {
    const net = server()
    const bytes = body(100_000)
    const original = net.ask
    let lied = false
    const sent = await BuffAccountUpload.send(
      ports(net, {
        ask: async (fields) => {
          const reply = await original(fields)
          // Сервер принял часть, но назвал прежнее число: следующая должна быть той, что он ждёт.
          if (!lied && (fields.chunk as { seq: number }).seq === 1) {
            lied = true
            return { ...reply, received: 1 }
          }
          return reply
        },
      }),
      bytes,
      65_536,
    )
    expect(sent.id).toBe("u_test0001")
    expect(net.calls.map((call) => (call.chunk as { seq: number }).seq)).toEqual([0, 1, 1, 2])
    expect(net.body().equals(bytes)).toBe(true)
  })

  test("человек остановил ответ — оставшиеся части не уходят", async () => {
    const abort = new AbortController()
    const net = server()
    const original = net.ask
    const failure = await BuffAccountUpload.send(
      ports(net, {
        ask: async (fields) => {
          abort.abort()
          return original(fields)
        },
      }),
      body(100_000),
      65_536,
      abort.signal,
    ).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(BuffAccountLink.Cut)
    expect(net.calls).toHaveLength(1)
  })
})
