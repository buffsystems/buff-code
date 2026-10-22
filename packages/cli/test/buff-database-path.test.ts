import { describe, expect, test } from "bun:test"
import path from "node:path"
import { databasePath } from "../src/database-path"

// #510: своя база — buffcode*.db; уже существующая апстримная остаётся в работе, пока своей нет.
describe("файл базы Buff Code", () => {
  const data = "/data"
  const has = (files: string[]) => (file: string) => files.includes(file)
  const own = path.resolve(data, path.basename(databasePath(data, has([]))))

  test("на чистой машине — своя база buffcode", () => {
    expect(path.basename(databasePath(data, has([])))).toMatch(/^buffcode(-[\w.-]+)?\.db$/)
  })

  test("есть только апстримная — работаем с ней: история сессий остаётся на месте", () => {
    const legacy = own.replace(/buffcode(-[\w.-]+)?\.db$/, (_, s = "") => `opencode${s}.db`)
    expect(databasePath(data, has([legacy]))).toBe(legacy)
  })

  test("есть своя — она, даже если апстримная тоже лежит рядом", () => {
    const legacy = own.replace("buffcode", "opencode")
    expect(databasePath(data, has([own, legacy]))).toBe(own)
  })
})
