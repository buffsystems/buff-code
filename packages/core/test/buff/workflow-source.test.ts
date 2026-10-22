// Сценарии (#448): откуда инструмент берёт скрипт — текстом (в черновик), файлом или сохранённый с аргументами.
import { describe, expect, test } from "bun:test"
import { WorkflowSource } from "../../src/buff/workflow/source"

function deps() {
  const files = new Map<string, string>([
    ["/p/wf.ts", "return 1"],
    ["/drafts/old.ts", "return 2"],
    ["/etc/secret.ts", "return 3"],
  ])
  let n = 0
  return {
    files,
    deps: {
      directory: "/p",
      drafts: "/drafts",
      draft: async (text: string) => {
        const file = `/drafts/d${++n}.ts`
        files.set(file, text)
        return file
      },
      read: async (file: string) => files.get(file),
      saved: async (name: string) =>
        name === "review"
          ? {
              meta: {
                name: "review",
                description: "Ревью",
                args: { branch: { type: "string" as const, required: true } },
              },
              script: "return args.branch",
              path: "/w/review.dwf.ts",
            }
          : name === "bad"
            ? { problem: "Нет заголовка" }
            : undefined,
    },
  }
}

describe("a script source", () => {
  test("exactly one source", async () => {
    const { deps: d } = deps()
    expect(await WorkflowSource.resolve({}, d)).toEqual({ problem: WorkflowSource.ONE })
    expect(await WorkflowSource.resolve({ script: "x", path: "y" }, d)).toEqual({ problem: WorkflowSource.ONE })
  })
  test("inline: written to a draft first — the file the diagnostics address", async () => {
    const { deps: d, files } = deps()
    const got = await WorkflowSource.resolve({ script: "return 5" }, d)
    expect(got).toEqual({ text: "return 5", path: "/drafts/d1.ts" })
    expect(files.get("/drafts/d1.ts")).toBe("return 5")
  })
  test("a file: in the project or a draft, relative to the project", async () => {
    const { deps: d } = deps()
    expect(await WorkflowSource.resolve({ path: "wf.ts" }, d)).toEqual({ text: "return 1", path: "/p/wf.ts" })
    expect(await WorkflowSource.resolve({ path: "/drafts/old.ts" }, d)).toEqual({
      text: "return 2",
      path: "/drafts/old.ts",
    })
  })
  test("a file elsewhere or missing is refused", async () => {
    const { deps: d } = deps()
    expect(await WorkflowSource.resolve({ path: "/etc/secret.ts" }, d)).toHaveProperty("problem")
    expect(await WorkflowSource.resolve({ path: "../etc/secret.ts" }, d)).toHaveProperty("problem")
    expect(await WorkflowSource.resolve({ path: "nope.ts" }, d)).toHaveProperty("problem")
  })
  test("saved: checked args, a draft copy so edits never touch the saved file", async () => {
    const { deps: d } = deps()
    expect(await WorkflowSource.resolve({ saved: { name: "review", args: { branch: "main" } } }, d)).toEqual({
      text: "return args.branch",
      path: "/drafts/d1.ts",
      args: { branch: "main" },
      workflow: "review",
    })
  })
  test("saved: missing, unreadable, wrong args", async () => {
    const { deps: d } = deps()
    expect(await WorkflowSource.resolve({ saved: { name: "nope" } }, d)).toHaveProperty("problem")
    expect(await WorkflowSource.resolve({ saved: { name: "bad" } }, d)).toEqual({ problem: "Нет заголовка" })
    const wrong = await WorkflowSource.resolve({ saved: { name: "review", args: {} } }, d)
    expect("problem" in wrong && wrong.problem).toContain("branch")
  })
})
