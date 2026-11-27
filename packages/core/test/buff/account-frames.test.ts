// Ответы сервера гостю (#966): простой, большой по кускам и поток — на записанных кадрах.
import { describe, expect, test } from "bun:test"
import { BuffAccountFrames } from "../../src/buff/account/frames"

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64")
const piece = (seq: number, text: string, id = "9f1c0000aaaa0001") => ({ chunk: { id, seq }, data: b64(text) })
const texts = (events: BuffAccountFrames.Event[]) =>
  events.flatMap((event) => (event.type === "data" ? [Buffer.from(event.bytes).toString("utf8")] : []))

describe("простой ответ", () => {
  test("одно сообщение без chunk — ответ целиком; дальше ничего не ждём", () => {
    const reader = BuffAccountFrames.reader()
    expect(reader.push({ ok: true, login: "ivan" })).toEqual([{ type: "plain", reply: { ok: true, login: "ivan" } }])
    expect(reader.push({ ok: true, login: "other" })).toEqual([])
  })

  test("отказ — тоже простой ответ, словами для человека", () => {
    const refusal = { ok: false, error: "Устройство отозвано — войдите заново." }
    expect(BuffAccountFrames.reader().push(refusal)).toEqual([{ type: "plain", reply: refusal }])
  })

  test("не объект — не ответ", () => {
    expect(BuffAccountFrames.reader().push("text")).toEqual([])
    expect(BuffAccountFrames.reader().push(null)).toEqual([])
  })
})

describe("большой ответ по кускам (of)", () => {
  const json = JSON.stringify({ ok: true, tiers: [{ id: "fast", name: "Быстрая" }] })
  const bytes = Buffer.from(json, "utf8")
  // Граница куска режет многобайтовую букву: склеивать надо байты, а не строки.
  const cut = bytes.indexOf(Buffer.from("Б")) + 1
  const frames = [
    { chunk: { id: "a1", seq: 0, of: 2 }, data: bytes.subarray(0, cut).toString("base64") },
    { chunk: { id: "a1", seq: 1, of: 2 }, data: bytes.subarray(cut).toString("base64") },
  ]

  test("куски склеиваются по seq в один ответ", () => {
    const reader = BuffAccountFrames.reader()
    expect(reader.push(frames[0])).toEqual([])
    expect(reader.push(frames[1])).toEqual([{ type: "plain", reply: JSON.parse(json) }])
  })

  test("порядок прихода не важен", () => {
    const reader = BuffAccountFrames.reader()
    expect(reader.push(frames[1])).toEqual([])
    expect(reader.push(frames[0])).toEqual([{ type: "plain", reply: JSON.parse(json) }])
  })

  test("склеилось не в JSON — отказ, а не падение", () => {
    const reader = BuffAccountFrames.reader()
    expect(reader.push({ chunk: { id: "a1", seq: 0, of: 1 }, data: b64("<html>") })).toEqual([
      { type: "plain", reply: { ok: false, error: "malformed reply" } },
    ])
  })
})

describe("поток", () => {
  const id = "9f1c0000aaaa0001"

  test("пример из контракта: куски по порядку, конец подтверждается", () => {
    const reader = BuffAccountFrames.reader()
    const events = [
      ...reader.push(piece(0, '{"status":200,"content_type":"text/event-stream"}\n')),
      ...reader.push(piece(1, 'data: {"model":"optimal","choices":[{"delta":{"content":"при"}}]}\n\n')),
      ...reader.push(piece(2, "data: [DONE]\n\n")),
    ]
    expect(texts(events)).toHaveLength(3)
    expect(reader.stream()).toEqual({ id, next: 3 })
    expect(reader.push({ chunk: { id, seq: 3, last: true } })).toEqual([{ type: "ack", id, seq: 3 }, { type: "end" }])
    expect(reader.stream()).toBeUndefined()
  })

  test("сигнал «жив» ничего не несёт и порядок не сдвигает", () => {
    const reader = BuffAccountFrames.reader()
    expect(reader.push({ chunk: { id, beat: true } })).toEqual([{ type: "beat" }])
    expect(texts(reader.push(piece(0, "a")))).toEqual(["a"])
  })

  test("каждые 16 кусков — подтверждение", () => {
    const reader = BuffAccountFrames.reader()
    const acks = Array.from({ length: 40 }, (_, seq) => reader.push(piece(seq, "x")))
      .flat()
      .flatMap((event) => (event.type === "ack" ? [event.seq] : []))
    expect(acks).toEqual([15, 31])
  })

  test("пропуск куска: просим повторить с ожидаемого — один раз, лишнее отбрасываем", () => {
    const reader = BuffAccountFrames.reader()
    reader.push(piece(0, "a"))
    expect(reader.push(piece(2, "c"))).toEqual([{ type: "resume", id, seq: 1 }])
    expect(reader.push(piece(3, "d"))).toEqual([])
    // Сервер шлёт заново с первого потерянного.
    expect(texts(reader.push(piece(1, "b")))).toEqual(["b"])
    expect(texts(reader.push(piece(2, "c")))).toEqual(["c"])
    // Новый пропуск — новая просьба.
    expect(reader.push(piece(5, "f"))).toEqual([{ type: "resume", id, seq: 3 }])
  })

  test("повтор уже принятого куска не дублирует данные", () => {
    const reader = BuffAccountFrames.reader()
    reader.push(piece(0, "a"))
    reader.push(piece(1, "b"))
    expect(reader.push(piece(0, "a"))).toEqual([])
    expect(reader.push(piece(1, "b"))).toEqual([])
  })

  test("обрыв сервером — его словами, и тоже подтверждается", () => {
    const reader = BuffAccountFrames.reader()
    reader.push(piece(0, "a"))
    expect(reader.push({ chunk: { id, seq: 1, error: "отменено" } })).toEqual([
      { type: "ack", id, seq: 1 },
      { type: "failed", message: "отменено" },
    ])
    expect(reader.push(piece(2, "late"))).toEqual([])
  })

  test("кадр чужого потока на том же адресе не принимается", () => {
    const reader = BuffAccountFrames.reader()
    reader.push(piece(0, "a"))
    expect(reader.push(piece(1, "чужое", "ffff0000aaaa0002"))).toEqual([])
    expect(reader.stream()).toEqual({ id, next: 1 })
  })

  test("вместо потока может прийти простой отказ", () => {
    const refusal = { ok: false, error: "token required" }
    expect(BuffAccountFrames.reader().push(refusal)).toEqual([{ type: "plain", reply: refusal }])
  })
})
