// Where a composer document lives (#584): the Solid window's Persist targets for the prompt of a
// session, of a new-session draft and the prompt history, reproduced key for key.

import { pathKey } from "@opencode/app/react-reuse/path-key"
import { base64Encode, checksum } from "@opencode/util/encode"
import type { DocumentTarget } from "./document"

const GLOBAL_STORAGE = "opencode.global.dat"
const separator = "\u0000"

export function workspaceStorage(dir: string) {
  const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  return `opencode.workspace.${head}.${checksum(dir) ?? "0"}.dat`
}

export function draftStorage(draftID: string) {
  const head = (draftID.slice(0, 12) || "draft").replace(/[^a-zA-Z0-9._-]/g, "-")
  return `opencode.draft.${head}.${checksum(draftID) ?? "0"}.dat`
}

function workspaceAliases(dir: string) {
  const storage = workspaceStorage(pathKey(dir))
  const result = new Set<string>()
  const raw = workspaceStorage(dir)
  if (raw !== storage) result.add(raw)
  const key = pathKey(dir)
  if (key.length >= 3 && key[1] === ":" && key[2] === "/") {
    const backslash = workspaceStorage(key.replaceAll("/", "\\"))
    if (backslash !== storage) result.add(backslash)
  }
  return result.size === 0 ? undefined : [...result]
}

/** A key in a workspace's namespace on a server scope ("local" or a server key). */
export function workspaceTarget(scope: string, directory: string, key: string): DocumentTarget {
  if (scope !== "local") return { storage: workspaceStorage([scope, pathKey(directory)].join(separator)), key }
  return { storage: workspaceStorage(pathKey(directory)), aliases: workspaceAliases(directory), key }
}

/** The prompt of a session (or of a workspace without one). */
export function sessionPromptTarget(scope: string, directory: string, sessionID?: string): DocumentTarget {
  const target = workspaceTarget(scope, directory, sessionID ? `session:${sessionID}:prompt` : "workspace:prompt")
  if (scope !== "local") return target
  return { ...target, previousKey: `${base64Encode(directory)}/prompt${sessionID ? "/" + sessionID : ""}.v2` }
}

/** The prompt of a new-session draft tab. */
export function draftPromptTarget(draftID: string): DocumentTarget {
  return { storage: draftStorage(draftID), key: "draft:prompt" }
}

export function historyTarget(mode: "normal" | "shell"): DocumentTarget {
  return { storage: GLOBAL_STORAGE, key: mode === "shell" ? "prompt-history-shell" : "prompt-history" }
}
