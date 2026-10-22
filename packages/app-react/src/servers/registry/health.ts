// Whether a server answers (#584), ported from the Solid window's runtime/server/health.ts: the
// add/edit dialog checks an address before saving it, retrying a dropped connection twice. The
// rows of the window's own servers read their live connection instead of polling.

import { createApiForServer } from "@opencode/app/react-reuse/server-api"
import type { ServerHttp } from "../../core/servers"

export type ServerHealth = { healthy: boolean; version?: string; incompatible?: boolean; checking?: boolean }

const retryable = (error: unknown, signal: AbortSignal) => {
  if (signal.aborted || !(error instanceof Error)) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  if (error instanceof TypeError) return true
  return /network|fetch|econnreset|econnrefused|enotfound|timedout|transport/i.test(error.message)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function checkServerHealth(
  http: ServerHttp,
  fetch?: typeof globalThis.fetch,
  options: { timeoutMs?: number; retryCount?: number } = {},
): Promise<ServerHealth> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000)
  const api = createApiForServer({ server: http, fetch })
  const attempt = async (count: number): Promise<ServerHealth> => {
    const result = await api.server
      .info({ signal })
      .then((info) => ({ ok: true as const, version: info.version }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (result.ok) return { healthy: true, version: result.version }
    if (count >= (options.retryCount ?? 2) || !retryable(result.error, signal)) return { healthy: false }
    await wait(100 * (count + 1))
    return attempt(count + 1)
  }
  return attempt(0)
}
