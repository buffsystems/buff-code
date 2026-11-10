// Настройки → Модели → «Режимы по умолчанию» (#836): что показывает экран из конфига сервера —
// только глобальные документы, последний названный ключ побеждает.
import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client/promise"
import { defaultModes } from "./modes-model"

const doc = (info: { thinking?: string; context?: number }): ConfigEntry => ({ type: "document", info })
const directory: ConfigEntry = { type: "directory", path: "/repo" } as ConfigEntry

test("without the keys the defaults are the default level and the model's whole window", () => {
  expect(defaultModes([])).toEqual({ thinking: "default", context: 0 })
  expect(defaultModes([doc({})])).toEqual({ thinking: "default", context: 0 })
})

test("the last global document naming a key wins; a project's own documents do not count", () => {
  expect(defaultModes([doc({ thinking: "low", context: 64_000 }), doc({ thinking: "high" })])).toEqual({
    thinking: "high",
    context: 64_000,
  })
  expect(defaultModes([doc({ thinking: "low" }), directory, doc({ thinking: "max", context: 500_000 })])).toEqual({
    thinking: "low",
    context: 0,
  })
})
