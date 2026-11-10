export * as BuffConnectionText from "./connection-text.js"

import { BuffConnection } from "@opencode/schema/buff-connection"
import type { BuffMcp } from "@opencode/schema/buff-mcp"
import type { Mcp as McpSchema } from "@opencode/schema/mcp"
import type { Mcp } from "../mcp/index.js"

/**
 * Что слышит модель от инструментов подключений (#765): список, статус с инструментами,
 * результат пробного вызова. Коротко, по делу, без значений секретов.
 */

const RESULT_LIMIT = 2000

type ToolLike = { readonly server: string; readonly name: string; readonly description?: string | undefined }

const names = (tools: ReadonlyArray<ToolLike>) => tools.map((tool) => tool.name).join(", ")

export function list(entries: ReadonlyArray<BuffMcp.Entry>, tools: ReadonlyArray<ToolLike>): string {
  if (!entries.length) return "No connections yet."
  const lines = entries.map((entry) => {
    const own = tools.filter((tool) => tool.server === entry.name)
    const scope = entry.scope === "builtin" ? "built-in, not editable" : entry.scope
    const kind =
      entry.config?.type === "remote"
        ? entry.config.oauth === false
          ? "remote, key"
          : "remote, OAuth"
        : entry.config?.type === "local"
          ? "local"
          : ""
    const head = `- ${entry.name} (${[scope, kind].filter(Boolean).join("; ")}): ${BuffConnection.statusForModel(entry.status)}`
    return own.length ? `${head}\n  tools (${own.length}): ${names(own)}` : head
  })
  return lines.join("\n")
}

export function status(name: string, state: McpSchema.Status, tools: ReadonlyArray<ToolLike>): string {
  const head = `Connection «${name}»: ${BuffConnection.statusForModel(state)}`
  if (state.status !== "connected") return head
  if (!tools.length) return `${head}. It offers no tools.`
  const detail = tools.map((tool) => `- ${tool.name}${tool.description ? ` — ${oneLine(tool.description)}` : ""}`)
  return `${head}. Tools (${tools.length}):\n${detail.join("\n")}`
}

export function callResult(result: Mcp.ToolResult): string {
  const text = result.content
    .map((part) => (part.type === "text" ? part.text : `[${part.mimeType}]`))
    .join("\n")
    .trim()
  const body = result.structured !== undefined && !text ? JSON.stringify(result.structured) : text
  const shortened = body.length > RESULT_LIMIT ? `${body.slice(0, RESULT_LIMIT)}… (shortened)` : body
  return result.isError ? `error — ${shortened || "(no details)"}` : `ok — ${shortened || "(empty result)"}`
}

const oneLine = (text: string) => {
  const line = text.split("\n")[0]!.trim()
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}
