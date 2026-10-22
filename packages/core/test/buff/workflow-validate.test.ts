// Сценарии (#448): ответ актёра сверяется со схемой результата — ошибки словами, чтобы актёр исправил.
import { describe, expect, test } from "bun:test"
import { WorkflowValidate } from "../../src/buff/workflow/validate"

const schema = {
  type: "object",
  properties: {
    path: { type: "string" },
    severity: { type: "string", enum: ["low", "high"] },
    count: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["path", "severity", "tags"],
  additionalProperties: false,
}

describe("checking a result against its schema", () => {
  test("a fitting value passes", () => {
    expect(
      WorkflowValidate.problems({ path: "a.ts", severity: "low", tags: [], count: 2, note: null }, schema),
    ).toEqual([])
  })
  test("every mismatch is named with its place", () => {
    expect(WorkflowValidate.problems({ severity: "medium", tags: ["x", 1], extra: true }, schema)).toEqual([
      "path: required field is missing",
      "severity: one of low, high",
      "tags[1]: expected a string",
      "extra: no such field in the schema",
    ])
    expect(WorkflowValidate.problems("текст", schema)).toEqual(["(result): expected an object"])
  })
  test("an empty schema accepts anything", () => {
    expect(WorkflowValidate.problems({ any: 1 }, {})).toEqual([])
  })
})
