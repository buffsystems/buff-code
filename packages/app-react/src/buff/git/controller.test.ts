import { expect, test } from "bun:test"
import type { BuffGit } from "@opencode/schema/buff-git"
import { createGitController, type GitRpc } from "./controller"

const clean: BuffGit.State = { branch: "main", ahead: 0, behind: 0, changes: [] }

function setup(inGit = true) {
  const calls: string[] = []
  const rpc: GitRpc = {
    state: async () => (inGit ? clean : Promise.reject(new Error("not a repository"))),
    branches: async () => ["main", "dev"],
    switch: async (input) => {
      calls.push(`switch ${input.branch} ${input.create ?? false}`)
      return { ...clean, branch: input.branch }
    },
    commit: async (input) => {
      if (!input.message) throw new Error("empty")
      calls.push(`commit ${input.files.join(",")}`)
      return { ...clean, ahead: 1 }
    },
    push: async () => clean,
    message: async (input) => ({ message: `msg ${input.sessionID ?? ""}` }),
    log: async () => [],
  }
  const git = createGitController({ rpc, directory: "/p", sessionID: "ses", refusal: () => "Git refused." })
  return { git, calls }
}

test("outside git there is no state; inside it loads", async () => {
  const outside = setup(false)
  await outside.git.refresh()
  expect(outside.git.state.get()).toBeUndefined()
  const inside = setup()
  await inside.git.refresh()
  expect(inside.git.state.get()?.branch).toBe("main")
})

test("writes replace the state; a refusal comes back as words", async () => {
  const { git, calls } = setup()
  expect(await git.commit("fix", ["a.ts"])).toBeUndefined()
  expect(git.state.get()?.ahead).toBe(1)
  expect(await git.commit("", ["a.ts"])).toBe("Git refused.")
  expect(await git.switch("feature", true)).toBeUndefined()
  expect(git.state.get()?.branch).toBe("feature")
  expect(calls).toEqual(["commit a.ts", "switch feature true"])
  expect(await git.message(["a.ts"])).toBe("msg ses")
})
