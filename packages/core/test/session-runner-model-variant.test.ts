import { expect, test } from "bun:test"
import { Model } from "@opencode/schema/model"
import type { Entry } from "@opencode/schema/config"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"

const doc = (info: Record<string, unknown>) => ({ type: "document", info }) as unknown as Entry

test("a session that names no variant runs at the config's thinking level (#900)", () => {
  expect(SessionRunnerModel.sessionVariant(undefined, [doc({ thinking: "low" }), doc({ thinking: "high" })])).toBe(
    Model.VariantID.make("high"),
  )
  expect(SessionRunnerModel.sessionVariant(Model.VariantID.make("max"), [doc({ thinking: "high" })])).toBe(
    Model.VariantID.make("max"),
  )
  // A stored session names "default" when it picked nothing — the same as naming none.
  expect(SessionRunnerModel.sessionVariant(Model.VariantID.make("default"), [doc({ thinking: "low" })])).toBe(
    Model.VariantID.make("low"),
  )
  expect(SessionRunnerModel.sessionVariant(undefined, [doc({ shell: "bash" })])).toBeUndefined()
  expect(SessionRunnerModel.sessionVariant(undefined, [doc({ thinking: "" })])).toBeUndefined()
})
