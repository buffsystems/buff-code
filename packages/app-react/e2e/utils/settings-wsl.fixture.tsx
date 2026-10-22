// The React window's counterpart of packages/app/e2e/utils/settings-wsl.fixture.tsx (#584): the
// window opened on /settings over a desktop platform whose one WSL distro is failed, stopped or
// ready, with OpenCode outdated in it. Its actions are written to the «WSL actions» output.

import "../../src/index.css"
import type { WslServersEvent, WslServersPlatform, WslServersState } from "@opencode/app/wsl/types"
import { mountApp } from "../../src/mount"
import { createWebPlatform } from "../../src/platform/web"

export function mount(input: { server: string; mode: "failed" | "stopped" | "ready" }) {
  const root = document.getElementById("root")
  const output = document.querySelector("output")
  if (!root || !output) throw new Error("Missing fixture root")
  const calls: string[] = []
  const state: { current: WslServersState } = {
    current: {
      runtime: { available: true, version: "2", error: null },
      installed: [],
      online: [],
      distroProbes: {},
      pendingRestart: false,
      job: null,
      servers: [
        {
          config: { id: "wsl:Ubuntu", distro: "Ubuntu" },
          runtime:
            input.mode === "ready"
              ? { kind: "ready", url: input.server, password: null }
              : input.mode === "failed"
                ? { kind: "failed", message: "WSL failed to start" }
                : { kind: "stopped" },
        },
      ],
      opencodeChecks: {
        Ubuntu: {
          distro: "Ubuntu",
          resolvedPath: "/usr/bin/opencode",
          version: "old",
          expectedVersion: "current",
          matchesDesktop: false,
          error: null,
        },
      },
    },
  }
  const listeners = new Set<(event: WslServersEvent) => void>()
  const record = (call: string, next: (current: WslServersState) => WslServersState) => {
    calls.push(call)
    output.textContent = calls.join(",")
    state.current = next(state.current)
    listeners.forEach((listener) => listener({ type: "state", state: structuredClone(state.current) }))
  }
  const unused = async () => {
    throw new Error("Unexpected fixture action")
  }
  const wsl: WslServersPlatform = {
    getState: async () => structuredClone(state.current),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    probeRuntime: unused,
    refreshDistros: unused,
    installWsl: unused,
    installDistro: unused,
    probeAddable: unused,
    openTerminal: unused,
    addServer: unused,
    async installOpencode(distro) {
      record(`update:${distro}`, (current) => ({
        ...current,
        opencodeChecks: {
          ...current.opencodeChecks,
          [distro]: { ...current.opencodeChecks[distro]!, version: "current", matchesDesktop: true },
        },
      }))
    },
    async startServer(id) {
      record(`start:${id}`, (current) => ({
        ...current,
        servers: current.servers.map((server) =>
          server.config.id === id
            ? { ...server, runtime: { kind: "ready", url: input.server, password: null } }
            : server,
        ),
      }))
    },
    async removeServer(id) {
      record(`remove:${id}`, (current) => ({
        ...current,
        servers: current.servers.filter((server) => server.config.id !== id),
      }))
    },
  }
  const web = createWebPlatform("test")
  mountApp(root, {
    platform: { ...web.platform, platform: "desktop", os: "windows", windowID: "settings-wsl-test", wslServers: wsl },
    servers: [{ type: "sidecar", variant: "base", displayName: "Local Server", http: { url: input.server } }],
    defaultServer: "sidecar",
    history: { type: "memory", initialUrl: "/settings" },
  })
}
