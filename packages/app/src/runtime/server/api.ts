import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"

// Окно ходит и на серверы прежних выпусков (удалённые, WSL) — им понятно только прежнее имя.
export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`${BuffServerAuth.LEGACY_USERNAME}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    password: decoded.slice(separator + 1),
  }
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient
