import { expect, test } from "bun:test"
import { readWhileCurrent } from "@opencode/app/react-reuse/current-read"
import { QueryClient } from "@tanstack/react-query"
import type { Server } from "../../core/servers"
import { fakeApi } from "../../core/data/fake-api"
import { worktreeDemand, worktreeKey } from "./inventory"

const root = "C:/OpenCode/WorkspaceAccent"
const workspace = `${root}/.worktrees/feature`

test("a failed worktree listing is retried while its place still shows, then discovery runs", async () => {
  let fail = true
  const fake = fakeApi({
    "worktree.list": () => {
      if (!fail) return [{ directory: root }, { directory: workspace, strategy: "git" }]
      fail = false
      throw new Error("500")
    },
    "worktree.refresh": () => undefined,
  })
  const server = { key: "local", api: () => fake.api } as unknown as Server
  const client = new QueryClient()
  readWhileCurrent(worktreeDemand({ client, server, projectID: "proj" }), { delay: 0 })
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(fake.called("worktree.list")).toHaveLength(2)
  expect(fake.called("worktree.refresh")).toHaveLength(1)
  expect(client.getQueryData<unknown>(worktreeKey("local", "proj"))).toEqual([
    { directory: root },
    { directory: workspace, strategy: "git" },
  ])
  client.clear()
})
