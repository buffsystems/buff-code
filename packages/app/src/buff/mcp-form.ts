import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import type { Mcp } from "@opencode/schema/mcp"

/**
 * Форма MCP-сервера в настройках (#444): поля ↔ запись в файле конфигурации. Две вкладки —
 * поля и JSON; во вторую вставляют описание из чужих настроек, в том числе целый блок
 * `mcpServers`. Настройки, которых в форме нет (время ожидания, вход), при правке сохраняются.
 */
export interface McpForm {
  readonly mode: "fields" | "json"
  readonly name: string
  readonly scope: BuffMcp.Scope
  readonly kind: "local" | "remote"
  readonly command: string
  readonly environment: string
  readonly url: string
  readonly headers: string
  readonly json: string
}

type Config = Mcp.ServerConfig
export type FormServers =
  | { readonly servers: readonly { readonly name: string; readonly config: Config }[] }
  | { readonly problem: string }

export function emptyForm(scope: BuffMcp.Scope): McpForm {
  return {
    mode: "fields",
    name: "",
    scope,
    kind: "local",
    command: "",
    environment: "",
    url: "",
    headers: "",
    json: "",
  }
}

export function formFromConfig(name: string, scope: BuffMcp.Scope, config: Config): McpForm {
  const shared = { ...emptyForm(scope), name, json: JSON.stringify(config, null, 2) }
  return config.type === "local"
    ? {
        ...shared,
        kind: "local",
        command: BuffMcp.commandLine(config.command),
        environment: BuffMcp.lines(config.environment),
      }
    : { ...shared, kind: "remote", url: config.url, headers: BuffMcp.lines(config.headers) }
}

/** Запись из полей; `base` — прежняя запись того же вида: из неё берётся то, чего в форме нет. */
function fromFields(form: McpForm, base: Config | undefined, t: BuffI18n.T): Config | { problem: string } {
  const pairs = form.kind === "local" ? form.environment : form.headers
  const problem = BuffMcp.pairsProblem(pairs, t)
  if (problem) return { problem }
  const values = BuffMcp.pairs(pairs)
  const some = Object.keys(values).length > 0
  if (form.kind === "local") {
    const { environment: _, ...kept } = base?.type === "local" ? base : ({} as Partial<Mcp.LocalConfig>)
    return {
      ...kept,
      type: "local",
      command: BuffMcp.command(form.command),
      ...(some ? { environment: values } : {}),
    } as Config
  }
  const { headers: _, ...kept } = base?.type === "remote" ? base : ({} as Partial<Mcp.RemoteConfig>)
  return { ...kept, type: "remote", url: form.url.trim(), ...(some ? { headers: values } : {}) } as Config
}

/** Что сохранить: один сервер из полей либо всё, что вставлено во вкладку JSON; `t` — язык отказа. */
export function formToServers(form: McpForm, base?: Config, t: BuffI18n.T = BuffI18n.english): FormServers {
  const named = (name: string, config: Config) => BuffMcp.nameProblem(name, t) ?? BuffMcp.configProblem(config, t)
  if (form.mode === "json") {
    const read = BuffMcp.fromJson(form.json, t)
    if ("problem" in read) return read
    const servers = read.servers.map((server) => ({ name: server.name ?? form.name.trim(), config: server.config }))
    const problem = servers.map((server) => named(server.name, server.config)).find(Boolean)
    return problem ? { problem } : { servers }
  }
  const name = form.name.trim()
  const nameProblem = BuffMcp.nameProblem(name, t)
  if (nameProblem) return { problem: nameProblem }
  const config = fromFields(form, base, t)
  if ("problem" in config) return config
  const problem = BuffMcp.configProblem(config, t)
  return problem ? { problem } : { servers: [{ name, config }] }
}
