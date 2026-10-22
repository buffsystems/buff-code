// Рабочий контекст читается для каталога, который TUI уже знает (#370): расположение
// приходит от сервера после подключения, и чтение до него попадает в чужой каталог.
import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { followDirectory } from "../../src/feature-plugins/buff/follow"

test("nothing is read until the directory is known; then once per directory", () => {
  const read: string[] = []
  const [directory, setDirectory] = createSignal<string | undefined>(undefined)
  const dispose = createRoot((dispose) => {
    followDirectory(directory, (d) => read.push(d))
    return dispose
  })
  expect(read).toEqual([])
  setDirectory("/work/shop")
  expect(read).toEqual(["/work/shop"])
  setDirectory("/work/shop")
  expect(read).toEqual(["/work/shop"])
  setDirectory("/work/pos")
  expect(read).toEqual(["/work/shop", "/work/pos"])
  dispose()
})
