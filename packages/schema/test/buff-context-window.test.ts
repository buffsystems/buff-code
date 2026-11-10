// Окно контекста (#836, эпик #783): лимит сессии словами — пресеты, «максимум модели», свой
// размер; и в окне, и в консоли, и в настройках; по-русски и по-английски.
import { expect, test } from "bun:test"
import { BuffContextWindow } from "../src/buff-context-window.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

test("tokens read as k and M", () => {
  expect(BuffContextWindow.format(64_000)).toBe("64k")
  expect(BuffContextWindow.format(200_000)).toBe("200k")
  expect(BuffContextWindow.format(1_000_000)).toBe("1M")
  expect(BuffContextWindow.format(1_500_000)).toBe("1.5M")
  expect(BuffContextWindow.format(12_345)).toBe("12k")
})

test("a preset, the model's maximum and a custom size each have a label and a hint", () => {
  expect(BuffContextWindow.label(64_000)).toBe("Compact, 64k")
  expect(BuffContextWindow.label(200_000)).toBe("Mid-size, 200k")
  expect(BuffContextWindow.label(500_000)).toBe("Large, 500k")
  expect(BuffContextWindow.label(0)).toBe("Model maximum")
  expect(BuffContextWindow.label(undefined, 400_000)).toBe("Model maximum, 400k")
  expect(BuffContextWindow.label(123_000)).toBe("Own size, 123k")
  for (const limit of [0, 64_000, 200_000, 500_000, 123_000]) {
    expect(BuffContextWindow.hint(limit).length).toBeGreaterThan(0)
    expect(BuffContextWindow.label(limit, undefined, ru)).not.toBe(BuffContextWindow.label(limit))
    expect(BuffContextWindow.hint(limit, ru)).not.toBe(BuffContextWindow.hint(limit))
  }
  expect(BuffContextWindow.label(64_000, undefined, ru)).toBe("Компактный, 64k")
  expect(BuffContextWindow.label(0, undefined, ru)).toBe("Максимум модели")
})

test("the choices: the model's maximum first, the presets within the model's window, then a custom one", () => {
  const ids = (model?: number, current?: number) => BuffContextWindow.options(model, current).map((o) => o.id)
  expect(ids(400_000)).toEqual(["0", "64000", "200000", "custom"])
  expect(ids(undefined)).toEqual(["0", "64000", "200000", "500000", "custom"])
  // The limit in force that is no preset is offered as it is, so the control can name it.
  expect(ids(400_000, 123_000)).toEqual(["0", "64000", "123000", "200000", "custom"])
  const first = BuffContextWindow.options(400_000)[0]
  expect(first?.label).toBe("Model maximum, 400k")
  expect(BuffContextWindow.options(undefined, undefined, ru).at(-1)?.label).toBe("Свой размер…")
})

test("an option id reads back as a limit; the custom id and junk read as nothing", () => {
  expect(BuffContextWindow.parse("0")).toBe(0)
  expect(BuffContextWindow.parse("200000")).toBe(200_000)
  expect(BuffContextWindow.parse("custom")).toBeUndefined()
  expect(BuffContextWindow.parse("abc")).toBeUndefined()
  expect(BuffContextWindow.parse("-5")).toBeUndefined()
})

test("the control names what it sets", () => {
  expect(BuffContextWindow.TITLE).toBe("Context window")
  expect(ru(BuffContextWindow.TITLE)).toBe("Окно контекста")
})

// #837: the helpers the window and the console share — the limit in force, the config's default,
// a typed custom size.
test("the session's cap cuts the model's window and never raises it; a zero cap is no cap", () => {
  expect(BuffContextWindow.effective(400_000, undefined)).toBe(400_000)
  expect(BuffContextWindow.effective(400_000, 200_000)).toBe(200_000)
  expect(BuffContextWindow.effective(100_000, 200_000)).toBe(100_000)
  expect(BuffContextWindow.effective(undefined, 200_000)).toBe(200_000)
  expect(BuffContextWindow.effective(400_000, 0)).toBe(400_000)
  expect(BuffContextWindow.effective(undefined, undefined)).toBeUndefined()
})

test("the last config document naming a cap wins; zero and absence mean none", () => {
  const doc = (info: { context?: number }) => ({ type: "document" as const, info })
  expect(BuffContextWindow.configured(undefined)).toBeUndefined()
  expect(BuffContextWindow.configured([doc({})])).toBeUndefined()
  expect(BuffContextWindow.configured([doc({ context: 0 })])).toBeUndefined()
  expect(BuffContextWindow.configured([doc({ context: 64_000 }), doc({ context: 200_000 })])).toBe(200_000)
  expect(BuffContextWindow.configured([doc({ context: 64_000 }), { type: "directory" as const }])).toBe(64_000)
})

test("a custom size is a whole number of tokens from 1k up to the model's window", () => {
  expect(BuffContextWindow.parseCustom("150000", 400_000)).toBe(150_000)
  expect(BuffContextWindow.parseCustom(" 150 000 ", 400_000)).toBe(150_000)
  expect(BuffContextWindow.parseCustom("150k", 400_000)).toBe(150_000)
  expect(BuffContextWindow.parseCustom("1.5M", undefined)).toBe(1_500_000)
  expect(BuffContextWindow.parseCustom("500", 400_000)).toBeUndefined()
  expect(BuffContextWindow.parseCustom("500000", 400_000)).toBeUndefined()
  expect(BuffContextWindow.parseCustom("abc", 400_000)).toBeUndefined()
  expect(BuffContextWindow.parseCustom("", 400_000)).toBeUndefined()
})
