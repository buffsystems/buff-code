import { expect, test } from "bun:test"
import type { Project } from "@opencode/client/promise"
import { settingsProjects, settingsServers } from "./inventory"

const project = (canonical: string, name: string): Project =>
  ({ id: `proj_${name}`, canonical, name, time: { created: 1, updated: 1 } }) as Project

test("open projects come first with the server's info, then known projects that were not closed", () => {
  const list = settingsProjects({
    open: [{ worktree: "/a", expanded: true }],
    known: [project("/b", "b"), project("/a", "a"), project("/c", "c")],
    closed: ["/c"],
  })
  expect(list.map((item) => [item.worktree, item.name, item.expanded])).toEqual([
    ["/a", "a", true],
    ["/b", "b", false],
  ])
})

test("a WSL server that is not ready keeps its row without a connection", () => {
  const servers = settingsServers(
    [{ type: "sidecar", variant: "wsl", distro: "Ubuntu", http: { url: "http://wsl" } }],
    [
      { config: { id: "wsl:Ubuntu", distro: "Ubuntu" }, runtime: { kind: "stopped" } },
      { config: { id: "wsl:Debian", distro: "Debian" }, runtime: { kind: "failed", message: "no" } },
    ],
    [],
  )
  expect(servers.map((server) => [server.key, server.name, !!server.connection])).toEqual([
    ["wsl:Ubuntu", "Ubuntu", false],
    ["wsl:Debian", "Debian", false],
  ])
})
