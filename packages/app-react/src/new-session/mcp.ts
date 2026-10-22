// The draft's MCP switches (#584), ported from the Solid draft MCP controls: switches recorded on
// the draft per destination; applied at once in an existing directory, and before the first prompt
// in a worktree that does not exist yet.

import type { Server } from "../core/servers"

export type McpText = {
  unavailable: (name: string) => string
  signIn: (name: string) => string
  notReady: (name: string) => string
  /** The server's sign-in asks for a form the window cannot show. */
  interactiveForm: (name: string) => string
}

/** What a switch needs from the window: its words, a browser for a sign-in, a place to say a failure. */
export type McpHost = { text: McpText; openExternal(url: string): void; failed(error: unknown): void }

/**
 * Turn one MCP server on or off in a directory and refresh the window's lists there, as the Solid
 * useMcpToggle: a server that needs a sign-in opens its OAuth page; a connection that ends failed
 * throws its error.
 */
export async function toggleMcp(
  server: Server,
  input: { name: string; enabled: boolean; directory: string },
  host: Pick<McpHost, "text" | "openExternal">,
) {
  const location = { directory: input.directory }
  const api = server.api()
  const current = (await api.mcp.list({ location })).data.find((item) => item.name === input.name)
  if (!current) return
  if (!input.enabled) await api.mcp.disconnect({ server: input.name, location })
  if (input.enabled && current.status.status !== "needs_auth") await api.mcp.connect({ server: input.name, location })
  server.data.location.mcpServer.invalidate(location)
  await server.data.location.mcpServer.sync(location)
  const after = server.data.location.mcpServer.list(location)?.find((item) => item.name === input.name)
  if (input.enabled && after?.status.status === "needs_auth" && after.integrationID) {
    const integration = await api.integration.get({ integrationID: after.integrationID, location })
    const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)
    if (!method || method.type !== "oauth") throw new Error(host.text.interactiveForm(input.name))
    const attempt = await api.integration.oauth.connect({
      integrationID: after.integrationID,
      methodID: method.id,
      location,
    })
    host.openExternal(attempt.data.url)
  }
  server.data.location.mcpResource.invalidate(location)
  await server.data.location.mcpResource.sync(location)
  // A successful HTTP response can still leave the MCP connection in a failed state.
  const status = after?.status
  if (status?.status === "failed") throw new Error(`${input.name}: ${status.error}`)
}

/**
 * Bring a directory's MCP servers to the draft's switches, after a switch still going there;
 * throws a sentence for the person when a server is missing or not ready, resolves false when a
 * toggle failed (and says why through the host).
 */
export async function applyMcp(
  server: Server,
  directory: string,
  states: Readonly<Record<string, boolean>>,
  host: McpHost,
  pending?: Promise<boolean>,
) {
  if (pending && !(await pending)) return false
  const text = host.text
  const entries = Object.entries(states)
  if (entries.length === 0) return true
  const location = { directory }
  const catalog = (await server.api().mcp.list({ location })).data
  const missing = entries.find(([name, enabled]) => enabled && !catalog.some((item) => item.name === name))
  if (missing) throw new Error(text.unavailable(missing[0]))
  const results = await Promise.all(
    entries
      .filter(([name, enabled]) => {
        const item = catalog.find((entry) => entry.name === name)
        return item && (enabled ? item.status.status !== "connected" : item.status.status !== "disabled")
      })
      .map(([name, enabled]) =>
        toggleMcp(server, { name, enabled, directory }, host).then(
          () => true,
          (error: unknown) => {
            host.failed(error)
            return false
          },
        ),
      ),
  )
  if (results.some((ok) => !ok)) return false
  const current = (await server.api().mcp.list({ location })).data
  const unresolved = entries.find(([name, enabled]) => {
    const status = current.find((item) => item.name === name)?.status.status
    return enabled ? status !== "connected" : status !== undefined && status !== "disabled"
  })
  if (!unresolved) return true
  const status = current.find((item) => item.name === unresolved[0])?.status.status
  throw new Error(status === "needs_auth" ? text.signIn(unresolved[0]) : text.notReady(unresolved[0]))
}
