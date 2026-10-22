import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { fakeApi } from "../../../core/data/fake-api"
import { applyListing, childrenOf, createFiles, type FilesState } from "./model"

const directory = "/repo"
const bytes = (text: string | undefined) => new TextEncoder().encode(text ?? "")
const entry = (path: string, type: "file" | "directory" = "file") => ({ path, type })
const changed = (file: string, event: "add" | "change" | "unlink"): OpenCodeEvent =>
  ({ id: `evt_${file}`, created: 1, type: "filesystem.changed", location: { directory }, data: { file, event } }) as OpenCodeEvent

function setup(routes: Parameters<typeof fakeApi>[0]) {
  const fake = fakeApi(routes)
  const errors: string[] = []
  const files = createFiles({
    api: () => fake.api,
    directory,
    onError: (kind, message) => errors.push(`${kind}:${message}`),
    formatError: (error) => (error instanceof Error ? error.message : String(error)),
  })
  return { files, fake, errors }
}

describe("createFiles", () => {
  test("reads a file once and keeps its text", async () => {
    const { files, fake } = setup({ "file.read": () => bytes("hello") })
    await Promise.all([files.load("src/a.ts"), files.load(`${directory}/src/a.ts`)])
    expect(fake.called("file.read")).toHaveLength(1)
    expect(files.get("src/a.ts")?.content?.content).toBe("hello")
    await files.load("src/a.ts")
    expect(fake.called("file.read")).toHaveLength(1)
  })

  test("a missing file is marked not found and reported", async () => {
    const missing = Object.assign(new Error("File not found: a.ts"), { _tag: "FileNotFoundError", path: "a.ts" })
    const { files, errors } = setup({
      "file.read": () => Promise.reject(missing),
    })
    await files.load("a.ts")
    expect(files.get("a.ts")?.loading).toBe(false)
    expect(files.get("a.ts")?.error).toBe("File not found: a.ts")
    expect(errors).toEqual(["load:File not found: a.ts"])
  })

  test("lists a directory and relists it when a child is added", async () => {
    const listings = [[entry("a.ts")], [entry("a.ts"), entry("b.ts")]]
    const { files, fake } = setup({ "file.list": () => ({ data: listings.shift() ?? [] }) })
    await files.tree.list("")
    expect(childrenOf(files.store.get(), "").map((node) => node.name)).toEqual(["a.ts"])
    files.handle(changed("b.ts", "add"))
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fake.called("file.list")).toHaveLength(2)
    expect(childrenOf(files.store.get(), "").map((node) => node.path)).toEqual(["a.ts", "b.ts"])
  })

  test("a change to an open file reads it again", async () => {
    const contents = ["one", "two"]
    const { files, fake } = setup({ "file.read": () => bytes(contents.shift()) })
    await files.load("a.ts")
    files.handle(changed("a.ts", "change"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fake.called("file.read")).toHaveLength(2)
    expect(files.get("a.ts")?.content?.content).toBe("two")
  })

  test("events of other workspaces are ignored", async () => {
    const { files, fake } = setup({ "file.read": () => bytes("x") })
    await files.load("a.ts")
    files.handle({ ...changed("a.ts", "change"), location: { directory: "/other" } } as OpenCodeEvent)
    expect(fake.called("file.read")).toHaveLength(1)
  })
})

test("applyListing drops removed entries and everything under removed folders", () => {
  const state: FilesState = {
    file: {},
    node: {
      src: { name: "src", path: "src", absolute: "/repo/src", type: "directory", ignored: false },
      "src/a.ts": { name: "a.ts", path: "src/a.ts", absolute: "/repo/src/a.ts", type: "file", ignored: false },
      "b.ts": { name: "b.ts", path: "b.ts", absolute: "/repo/b.ts", type: "file", ignored: false },
    },
    dir: { "": { expanded: true, loaded: true, children: ["src", "b.ts"] } },
  }
  const next = applyListing(state, "", [state.node["b.ts"]!])
  expect(Object.keys(next.node)).toEqual(["b.ts"])
  expect(next.dir[""]?.children).toEqual(["b.ts"])
})
