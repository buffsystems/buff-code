// Язык разовых команд (#472): тот, что выбран в окне, — его хранит служба; пока не выбран или
// служба не ответила — русский.
import { beforeEach, describe, expect, test } from "bun:test"
import { followLocale, t } from "../src/buff/locale"
import { describe as describeChoice } from "../src/commands/handlers/buff/context"
import { buffModelsHint } from "../src/commands/handlers/buff/models-hint"

describe("язык разовых команд", () => {
  beforeEach(() => followLocale(async () => "ru"))

  test("по умолчанию — русский", () => {
    expect(t("Sign-in failed")).toBe("Вход не удался")
  })

  test("язык берётся у службы", async () => {
    await followLocale(async () => "en")
    expect(t("Sign-in failed")).toBe("Sign-in failed")
    expect(describeChoice(null)).toBe("no context selected")
    expect(describeChoice({ org: "acme", project: null, spaces: ["handbook"] })).toBe(
      "acme › no project · spaces: handbook",
    )
    expect(buffModelsHint({ hasBuffModels: false, org: "acme" })).toBe(
      "The company connector returned no models for the organization acme.",
    )
  })

  test("служба не ответила — язык прежний", async () => {
    await followLocale(async () => "en")
    await followLocale(() => Promise.reject(new Error("down")))
    expect(t("Sign-in failed")).toBe("Sign-in failed")
  })

  test("по-русски — из каталога", () => {
    expect(describeChoice({ org: "acme", project: "shop", spaces: [] })).toBe("acme › shop")
    expect(describeChoice({ org: "acme", project: null, spaces: ["handbook"] })).toBe(
      "acme › без проекта · пространства: handbook",
    )
    expect(describeChoice(null)).toBe("контекст не выбран")
  })
})
