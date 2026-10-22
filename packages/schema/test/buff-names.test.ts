import { describe, expect, test } from "bun:test"
import { BuffNames } from "../src/buff-names.js"

// #510: свои имена на диске — buffcode; апстримные читаются, чтобы ничего не сломать.
describe("имена Buff Code на диске", () => {
  test("свои файлы конфигурации грузятся последними и перекрывают апстримные", () => {
    const order = [...BuffNames.CONFIG_FILES]
    expect(order.indexOf("buffcode.json")).toBeGreaterThan(order.indexOf("opencode.jsonc"))
    expect(order.at(-1)).toBe("buffcode.jsonc")
  })

  test("пишем в свой каталог; в апстримный — только если кроме него ничего нет", () => {
    const has = (dirs: string[]) => (p: string) => dirs.includes(p)
    const pick = (dirs: string[]) => BuffNames.pick("/p/.buffcode", "/p/.opencode", has(dirs))
    expect(pick([])).toBe("/p/.buffcode")
    expect(pick(["/p/.opencode"])).toBe("/p/.opencode")
    expect(pick(["/p/.opencode", "/p/.buffcode"])).toBe("/p/.buffcode")
  })

  test("оба каталога проекта узнаются", () => {
    expect(BuffNames.isProjectDir(".buffcode")).toBe(true)
    expect(BuffNames.isProjectDir(".opencode")).toBe(true)
    expect(BuffNames.isProjectDir(".claude")).toBe(false)
  })
})
