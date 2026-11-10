// Видимость моделей (#743): отметка человека, иначе новейшая в семействе за полгода и модели без даты.
import { describe, expect, test } from "bun:test"
import { BuffModelPrefs } from "../src/buff-model-prefs.js"

const now = Date.parse("2026-11-02")
const day = 24 * 60 * 60 * 1000
const model = (providerID: string, modelID: string, released: number | undefined, family = "f") => ({
  providerID,
  modelID,
  family,
  released,
})

describe("filter", () => {
  test("without choices: the newest of a family within six months, and the undated", () => {
    const models = [
      model("anthropic", "sonnet-5", now - 10 * day),
      model("anthropic", "sonnet-4", now - 100 * day),
      model("anthropic", "haiku", now - 20 * day, "haiku"),
      model("anthropic", "ancient", now - 400 * day, "old"),
      model("openrouter", "mystery", undefined),
      model("openrouter", "zero", 0),
    ]
    expect(BuffModelPrefs.filter(models, [], now).map((m) => m.modelID)).toEqual(["sonnet-5", "haiku", "mystery", "zero"])
  })

  // #763: a model from the person's own provider has no release date — the schema writes 0 for it.
  // That is «unknown», not 1970: it shows by default, and a «hide» still hides it.
  test("released 0 is an unknown date: shown by default, hidden on request", () => {
    const own = [model("litellm", "deepseek", 0), model("litellm", "glm", 0)]
    expect(BuffModelPrefs.filter(own, [], now).map((m) => m.modelID)).toEqual(["deepseek", "glm"])
    expect(
      BuffModelPrefs.filter(own, [{ providerID: "litellm", modelID: "glm", visibility: "hide" }], now).map((m) => m.modelID),
    ).toEqual(["deepseek"])
  })

  test("a choice wins over the rule, both ways", () => {
    const models = [model("a", "fresh", now - day), model("a", "stale", now - 300 * day)]
    const shown = BuffModelPrefs.filter(
      models,
      [
        { providerID: "a", modelID: "fresh", visibility: "hide" },
        { providerID: "a", modelID: "stale", visibility: "show" },
      ],
      now,
    )
    expect(shown.map((m) => m.modelID)).toEqual(["stale"])
  })

  test("families are per provider: the same family name at two providers keeps both newest", () => {
    const models = [model("a", "x", now - day, "fam"), model("b", "y", now - 2 * day, "fam")]
    expect(BuffModelPrefs.filter(models, [], now).map((m) => m.modelID)).toEqual(["x", "y"])
  })
})
