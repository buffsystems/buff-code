import { expect, test } from "bun:test"
import type { ModelInfo, ProviderInfo } from "@opencode/client/promise"
import { catalogModels, groupModels, latestModels, modelVisible, normalizeProviderList, paidProviders } from "./catalog"

const provider = (id: string): ProviderInfo => ({ id, name: id.toUpperCase() }) as ProviderInfo
const model = (providerID: string, id: string, released: number, cost = 1, family = "f"): ModelInfo =>
  ({
    id,
    providerID,
    modelID: id,
    name: `${id} (latest)`,
    family,
    status: "active",
    capabilities: { input: ["text"], output: ["text"], tools: true },
    cost: [{ input: cost, output: cost, cache: { read: 0, write: 0 } }],
    limit: { context: 1000, output: 100 },
    time: { released },
    variants: [],
  }) as unknown as ModelInfo

test("models of connected providers, named without (latest); the free tier is not paid", () => {
  const now = Date.parse("2026-10-01")
  const catalog = normalizeProviderList(
    [provider("opencode"), provider("anthropic")],
    [model("opencode", "free", now, 0), model("anthropic", "old", now - 400 * 864e5), model("anthropic", "new", now)],
  )
  expect(catalogModels(catalog).map((item) => [item.provider.id, item.name, item.latest])).toEqual([
    ["opencode", "free", true],
    ["anthropic", "old", true],
    ["anthropic", "new", true],
  ])
  expect(paidProviders(catalog).map((item) => item.id)).toEqual(["anthropic"])
  const latest = latestModels(catalogModels(catalog), now)
  const [, old, fresh] = catalogModels(catalog)
  expect(modelVisible(fresh!, undefined, latest)).toBe(true)
  expect(modelVisible(old!, undefined, latest)).toBe(false)
  expect(modelVisible(old!, "show", latest)).toBe(true)
  expect(modelVisible(fresh!, "hide", latest)).toBe(false)
})

test("groups put the well-known providers first and match a search across names and ids", () => {
  const now = Date.parse("2026-10-01")
  const catalog = normalizeProviderList(
    [provider("zeta"), provider("anthropic"), provider("openai")],
    [model("zeta", "z1", now), model("openai", "gpt", now), model("anthropic", "sonnet", now)],
  )
  expect(groupModels(catalogModels(catalog), "").map((group) => group.provider)).toEqual([
    "anthropic",
    "openai",
    "zeta",
  ])
  expect(groupModels(catalogModels(catalog), "son").map((group) => group.items.map((item) => item.id))).toEqual([
    ["sonnet"],
  ])
})

// #763: a model of the person's own provider has no release date (released 0, "1970-01-01" here):
// the pickers show it without a choice, and a «hide» still hides it.
test("a model without a release date shows in the pickers by default", () => {
  const own = { id: "deepseek", release_date: new Date(0).toISOString().slice(0, 10), provider: { id: "litellm" } }
  expect(modelVisible(own as never, undefined, new Set())).toBe(true)
  expect(modelVisible(own as never, "hide", new Set())).toBe(false)
})
