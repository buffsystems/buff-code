// #538: журнал движка уезжает в склад строками его же базы, а не чтением файла с общего диска.
// Здесь — накопитель строк: он живёт с первой строки процесса, до открытия базы.
import { beforeEach, expect, test } from "bun:test"
import { LogJournal } from "../src/observability/journal.js"

beforeEach(() => {
  LogJournal.take()
})

test("строки забираются по порядку и один раз", () => {
  LogJournal.push("a")
  LogJournal.push("b")
  expect(LogJournal.take()).toEqual({ lines: ["a", "b"], dropped: 0 })
  expect(LogJournal.take()).toEqual({ lines: [], dropped: 0 })
})

test("сверх лимита вытесняются самые старые строки, и их число не теряется", () => {
  LogJournal.push("1234", 10)
  LogJournal.push("5678", 10)
  LogJournal.push("90ab", 10)
  expect(LogJournal.take()).toEqual({ lines: ["5678", "90ab"], dropped: 1 })
})

test("собственные строки отправителя очереди в журнал склада не попадают — иначе петля", () => {
  expect(LogJournal.journaled(["outbox: the warehouse did not accept the batch"])).toBe(false)
  expect(LogJournal.journaled("outbox: sender started")).toBe(false)
  expect(LogJournal.journaled(["session started", { id: "s1" }])).toBe(true)
})

test("копит только раннер: у разработчика журнал никуда не уезжает", () => {
  expect(LogJournal.enabled({ BUFF_RUNNER: '{"org":"acme"}' })).toBe(true)
  expect(LogJournal.enabled({})).toBe(false)
})
