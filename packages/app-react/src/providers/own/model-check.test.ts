// Which model the check offers first (#562): never a random catalog entry.
import { describe, expect, test } from "bun:test"
import { checkable, defaultCheckModel } from "./model-check"

const models = [
  { id: "prism-ml/ternary-bonsai", released: "2026-10-01" },
  { id: "z-ai/glm-5.3-flash", released: "2026-09-01" },
  { id: "gpt-mock" },
]

describe("the model to check first", () => {
  test("the provider's recent pick, then the last session's, then a well-known vendor's", () => {
    expect(
      defaultCheckModel({
        providerID: "openrouter",
        models,
        recent: ["gone", "gpt-mock"],
        lastSession: "prism-ml/ternary-bonsai",
      }),
    ).toBe("gpt-mock")
    expect(
      defaultCheckModel({ providerID: "openrouter", models, recent: [], lastSession: "prism-ml/ternary-bonsai" }),
    ).toBe("prism-ml/ternary-bonsai")
    expect(defaultCheckModel({ providerID: "openrouter", models, recent: [], lastSession: "gone" })).toBe(
      "z-ai/glm-5.3-flash",
    )
  })

  test("a server without release dates offers its first model; none — nothing", () => {
    expect(defaultCheckModel({ providerID: "litellm", models: [{ id: "a" }, { id: "b" }], recent: [] })).toBe("a")
    expect(defaultCheckModel({ providerID: "litellm", models: [], recent: [] })).toBeUndefined()
  })
})

describe("the check button", () => {
  test("takes a model typed by hand, not only one the catalogue lists (#27)", () => {
    expect(checkable("deepseek/deepseek-v4.1-flash-1017")).toBe(true)
    expect(checkable("  ")).toBe(false)
  })
})
