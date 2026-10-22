// Вывод фоновой команды (#456): читается весь, страница за страницей, и дочитывается, пока она идёт.
import { expect, test } from "bun:test"
import { readShellOutput } from "./shell-follow"

function source(text: string, page: number) {
  const asked: number[] = []
  return {
    asked,
    load: async (cursor: number) => {
      asked.push(cursor)
      const output = text.slice(cursor, cursor + page)
      return { output, cursor: cursor + output.length, size: text.length }
    },
  }
}

test("everything captured so far is read, page by page — nothing is cut off", async () => {
  const { load, asked } = source("x".repeat(250_000), 100_000)
  const read = await readShellOutput(load, 0)
  expect(read.output.length).toBe(250_000)
  expect(read.cursor).toBe(250_000)
  expect(asked).toEqual([0, 100_000, 200_000])
})

test("a later read continues from the cursor", async () => {
  const { load, asked } = source("abcdef", 4)
  const read = await readShellOutput(load, 4)
  expect(read).toEqual({ output: "ef", cursor: 6 })
  expect(asked).toEqual([4])
})

test("a page that does not advance ends the read instead of spinning", async () => {
  const read = await readShellOutput(async (cursor) => ({ output: "", cursor, size: 10 }), 3)
  expect(read).toEqual({ output: "", cursor: 3 })
})
