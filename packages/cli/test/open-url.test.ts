// Вход не должен падать, если открыть браузер нечем (сервер по SSH, контейнер): ссылка и код
// уже на экране — открытие браузера лишь удобство (#401). `open` сообщает об этом событием
// error запущенного процесса, а не отказом промиса.
import { expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { Effect } from "effect"

const child = new EventEmitter()
mock.module("open", () => ({ default: () => Promise.resolve(child) }))

test("a browser that cannot be opened does not end the sign-in", async () => {
  const { openUrl } = await import("../src/ui/prompt")
  const exit = await Effect.runPromiseExit(openUrl("https://buff.systems/app/device?code=AAAA-BBBB"))
  expect(exit._tag).toBe("Success")
  // Without a listener this throws — the uncaught exception that ended the sign-in.
  expect(() => child.emit("error", new Error('Executable not found in $PATH: "xdg-open"'))).not.toThrow()
})
