import { describe, expect, test } from "bun:test"
import { ancestry, MAX_DEPTH } from "../../src/buff/mobile/ancestors.js"

const tree: Record<string, string | undefined> = { child: "parent", parent: "top", top: undefined, a: "b", b: "a" }

describe("ancestry", () => {
  test("a helper's change climbs to its chat and that chat's chat", async () => {
    const up = ancestry(async (s) => tree[s])
    expect(await up("child")).toEqual(["parent", "top"])
    expect(await up("top")).toEqual([])
  })

  test("each session's parent is asked once", async () => {
    const asked: string[] = []
    const up = ancestry(async (s) => (asked.push(s), tree[s]))
    await up("child")
    await up("child")
    expect(asked).toEqual(["child", "parent", "top"])
  })

  test("stops at the depth and on a loop or a failed lookup", async () => {
    const deep = ancestry(async (s) => `${s}x`)
    expect((await deep("s")).length).toBe(MAX_DEPTH)
    expect(await ancestry(async (s) => tree[s])("a")).toEqual(["b"])
    expect(await ancestry(async () => Promise.reject(new Error("gone")))("child")).toEqual([])
  })
})
