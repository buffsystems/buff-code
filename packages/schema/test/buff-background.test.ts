// Фоновая работа (#456): что сказать модели, когда её остановил человек, и сколько она уже идёт.
import { describe, expect, test } from "bun:test"
import { BuffBackground } from "../src/buff-background.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("a stop by the person", () => {
  test("a cancelled job does not wake the model and says who stopped it", () => {
    expect(BuffBackground.afterStop("cancelled", "Command cancelled")).toEqual({
      resume: false,
      text: "Command cancelled: stopped by the user.",
    })
  })
  test("work that ended by itself wakes the model with its own text, as before", () => {
    expect(BuffBackground.afterStop("completed", "exit 0")).toEqual({ text: "exit 0" })
    expect(BuffBackground.afterStop("error", "boom")).toEqual({ text: "boom" })
  })
})

describe("how long it runs", () => {
  test("seconds, minutes, hours — the short way", () => {
    expect(BuffBackground.elapsed(0, ru)).toBe("0 с")
    expect(BuffBackground.elapsed(42_400, ru)).toBe("42 с")
    expect(BuffBackground.elapsed(3 * 60_000 + 5_000, ru)).toBe("3 мин 05 с")
    expect(BuffBackground.elapsed(62 * 60_000 + 9_000, ru)).toBe("1 ч 02 мин")
    expect(BuffBackground.elapsed(-5, ru)).toBe("0 с")
    expect(BuffBackground.elapsed(3 * 60_000 + 5_000)).toBe("3 min 05 s")
  })
  test("from a start time to now", () => {
    expect(BuffBackground.since(1_000, 66_000, ru)).toBe("1 мин 05 с")
    expect(BuffBackground.since(undefined, 66_000)).toBeUndefined()
  })
})
