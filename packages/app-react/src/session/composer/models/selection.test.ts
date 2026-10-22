import { describe, expect, test } from "bun:test"
import type { ModelInfo, ProviderInfo } from "@opencode/client/promise"
import { normalizeProviderList } from "../../../providers/models/catalog"
import { chooseAgent, chooseModel, resolveSelection, type SelectionInput } from "./selection"

const provider = (id: string) => ({ id, name: id }) as ProviderInfo
const model = (providerID: string, id: string, variants: string[] = [], cost = 1) =>
  ({
    id,
    providerID,
    modelID: id,
    name: id,
    status: "active",
    cost: [{ input: cost, output: cost, cache: { read: 0, write: 0 } }],
    capabilities: { input: ["text"], output: ["text"], tools: true },
    limit: { context: 1000, output: 100 },
    time: { released: Date.now() },
    variants: variants.map((variant) => ({ id: variant })),
  }) as unknown as ModelInfo

const providers = [provider("opencode"), provider("opencode-go")]
const models = [model("opencode", "free", [], 0), model("opencode-go", "go", ["high"])]
const prefs = (recent: { providerID: string; modelID: string }[] = []) => ({
  visibility: () => undefined,
  recent: () => recent,
  variant: () => undefined,
  isReady: () => true,
})
const input = (extra: Partial<SelectionInput> = {}): SelectionInput => ({
  agents: [],
  agentsLoaded: true,
  catalog: normalizeProviderList(providers, models),
  catalogLoaded: true,
  config: [],
  prefs: prefs(),
  showCustomAgents: false,
  ...extra,
})

describe("model selection", () => {
  test("falls back to the recent model, then the first connected one", () => {
    expect(resolveSelection(input()).model?.id).toBe("free")
    expect(resolveSelection(input({ prefs: prefs([{ providerID: "opencode-go", modelID: "go" }]) })).model?.id).toBe("go")
  })

  // #562: without a recent pick, Buff comes first among the connected providers; a recent own one wins.
  test("without a recent pick Buff is the default, a recent own model wins over it", () => {
    const catalog = normalizeProviderList(
      [provider("anthropic"), provider("buff")],
      [model("anthropic", "claude"), model("buff", "tier-1")],
    )
    expect(resolveSelection(input({ catalog })).model?.id).toBe("tier-1")
    const recent = prefs([{ providerID: "anthropic", modelID: "claude" }])
    expect(resolveSelection(input({ catalog, prefs: recent })).model?.id).toBe("claude")
  })

  // #562: no recent pick in this window — the model of the last session (the console's too) wins over
  // the first model of a provider; a recent pick still wins over it.
  test("without a recent pick the last session's model is the default", () => {
    const lastSession = { providerID: "opencode-go", modelID: "go" }
    expect(resolveSelection(input({ lastSession })).model?.id).toBe("go")
    const recent = prefs([{ providerID: "opencode", modelID: "free" }])
    expect(resolveSelection(input({ lastSession, prefs: recent })).model?.id).toBe("free")
    expect(resolveSelection(input({ lastSession: { providerID: "gone", modelID: "x" } })).model?.id).toBe("free")
  })

  test("the session's own model wins over the recent one, a local pick over both", () => {
    const session = { model: { id: "go", providerID: "opencode-go" } }
    expect(resolveSelection(input({ session })).model?.id).toBe("go")
    const scope = { model: { providerID: "opencode", modelID: "free" } }
    expect(resolveSelection(input({ session, scope })).model?.id).toBe("free")
  })

  test("waits for the config before choosing", () => {
    expect(resolveSelection(input({ config: undefined })).model).toBeUndefined()
    expect(resolveSelection(input({ config: undefined })).loading).toBe(true)
  })

  test("a paid provider is any but the free OpenCode tier", () => {
    expect(resolveSelection(input()).paid).toBe(true)
    const free = input({ catalog: normalizeProviderList([provider("opencode")], [model("opencode", "free", [], 0)]) })
    expect(resolveSelection(free).paid).toBe(false)
  })

  test("variants resolve from the pick, and choosing another model drops the variant", () => {
    const scope = { model: { providerID: "opencode-go", modelID: "go" }, variant: "high" }
    const selection = resolveSelection(input({ scope }))
    expect(selection.variants).toEqual(["high"])
    expect(selection.variant).toBe("high")
    expect(chooseModel(selection, scope, { providerID: "opencode", modelID: "free" }).variant).toBeUndefined()
  })

  test("switching agents remembers each agent's model", () => {
    const agent = (name: string) => ({ name, mode: "primary" as const, permission: [], options: {} })
    const selection = resolveSelection(input({ agents: [agent("build"), agent("plan")], showCustomAgents: true }))
    const next = chooseAgent(selection, undefined, "plan")
    expect(next?.agent).toBe("plan")
    expect(next?.choices?.build?.model).toEqual({ providerID: "opencode", modelID: "free" })
  })
})
