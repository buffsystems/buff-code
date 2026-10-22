// Every workspace's terminals in the window (#584), created on first use and kept while the window
// switches sessions — the Solid TerminalProvider's cache, at most twenty workspaces per server,
// oldest first out. Keyed by the server's controller: one created again gets models on its own bus.

import { pathKey } from "@opencode/app/react-reuse/path-key"
import { ScopedKey, ServerScope } from "@opencode/app/react-reuse/server-scope"
import { checksum, base64Encode } from "@opencode/util/encode"
import type { Server } from "../../../core/servers"
import type { Platform } from "../../../platform/platform"
import { MAX_TERMINAL_SESSIONS } from "./state"
import { createWorkspaceTerminals, type WorkspaceTerminals } from "./terminals"

/** The Solid window's workspace namespace (`Persist.serverWorkspace`) for a directory. */
export function workspaceStorageName(scope: string, directory: string) {
  const dir = pathKey(base64Encode(directory))
  const name = scope === ServerScope.local ? dir : ScopedKey.from(scope as ServerScope, dir)
  const head = (name.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  return `opencode.workspace.${head}.${checksum(name) ?? "0"}.dat`
}

const registries = new WeakMap<Server, Map<string, WorkspaceTerminals>>()

export function workspaceTerminals(input: { platform: Platform; scope: string; server: Server; directory: string }) {
  const registry = registries.get(input.server) ?? new Map<string, WorkspaceTerminals>()
  registries.set(input.server, registry)
  const key = input.directory
  const existing = registry.get(key)
  if (existing) {
    registry.delete(key)
    registry.set(key, existing)
    return existing
  }
  const created = createWorkspaceTerminals({
    api: input.server.api,
    directory: input.directory,
    storage: input.platform.storage(workspaceStorageName(input.scope, input.directory)),
    event: input.server.event.location(input.directory),
  })
  registry.set(key, created)
  while (registry.size > MAX_TERMINAL_SESSIONS) {
    const [oldest, value] = registry.entries().next().value ?? []
    if (!oldest || !value) break
    value.dispose()
    registry.delete(oldest)
  }
  return created
}
