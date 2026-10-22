export * as BuffMcpFlow from "./buff-mcp-flow.js"

import { BuffI18n } from "./buff-i18n.js"
import { BuffMcp } from "./buff-mcp.js"
import type { Mcp } from "./mcp.js"

/**
 * Шаги управления MCP-серверами в консоли (#444): добавить, изменить, удалить — вопросами по
 * очереди. Диалоги приходят снаружи, так что шаги проверяются без терминала. `undefined` —
 * человек вышел из вопроса; `problem` — ответ не годится, сохранять нечего.
 */

interface Option<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
}

export interface Ui {
  select<Value>(dialog: { title: string; options: readonly Option<Value>[] }): Promise<Value | undefined>
  prompt(dialog: {
    title: string
    description?: string
    placeholder?: string
    value?: string
  }): Promise<string | undefined>
  confirm(dialog: { title: string; message: string }): Promise<boolean | undefined>
  /** Перевод строк шагов на язык консоли (#472); без него — английский. */
  t?: BuffI18n.T
}

/** Переводчик шагов: свой у консоли, иначе английский. */
export const tr = (ui: Ui): BuffI18n.T => ui.t ?? BuffI18n.english

type Target = { readonly scope: BuffMcp.Scope; readonly name: string }
type Server = { readonly name: string; readonly config: Mcp.ServerConfig }
export type Saved = { readonly scope: BuffMcp.Scope; readonly servers: readonly Server[]; readonly previous?: Target }
export type Problem = { readonly problem: string }

const checked = (servers: readonly Server[], t: BuffI18n.T): string | undefined =>
  servers.map((server) => BuffMcp.nameProblem(server.name, t) ?? BuffMcp.configProblem(server.config, t)).find(Boolean)

const name = (t: BuffI18n.T) => ({
  title: t("Server name"),
  description: t("Latin letters, digits, hyphen."),
  placeholder: "github",
})

export async function add(ui: Ui): Promise<Saved | Problem | undefined> {
  const t = tr(ui)
  const scope = await ui.select<BuffMcp.Scope>({
    title: t("Where to keep the server"),
    options: [
      { title: t("On my machine — for all projects"), value: "user", description: t("stays on this machine") },
      { title: t("In this project"), value: "project", description: t("goes to the repository — without keys") },
    ],
  })
  if (!scope) return
  const kind = await ui.select<"local" | "remote" | "json">({
    title: t("What to connect"),
    options: [
      { title: t("A command on this machine"), value: "local" },
      { title: t("An address on the network"), value: "remote" },
      { title: t("Paste JSON"), value: "json", description: t("another agent's entry or an mcpServers block") },
    ],
  })
  if (!kind) return
  if (kind === "json") {
    const text = await ui.prompt({
      title: t("Server description (JSON)"),
      placeholder: '{ "command": "npx", "args": ["-y", "srv"] }',
    })
    if (text === undefined) return
    const read = BuffMcp.fromJson(text, t)
    if ("problem" in read) return read
    const unnamed = read.servers.some((server) => !server.name)
    const given = unnamed ? await ui.prompt(name(t)) : ""
    if (given === undefined) return
    const servers = read.servers.map((server) => ({ name: server.name ?? given.trim(), config: server.config }))
    const problem = checked(servers, t)
    return problem ? { problem } : { scope, servers }
  }
  const given = await ui.prompt(name(t))
  if (given === undefined) return
  const value = await ui.prompt(
    kind === "local"
      ? {
          title: t("Start command"),
          description: t("The program and arguments, as in a terminal."),
          placeholder: "npx -y @acme/server",
        }
      : { title: t("Server address"), placeholder: "https://mcp.example.com/mcp" },
  )
  if (value === undefined) return
  const config = (
    kind === "local" ? { type: "local", command: BuffMcp.command(value) } : { type: "remote", url: value.trim() }
  ) as Mcp.ServerConfig
  const servers = [{ name: given.trim(), config }]
  const problem = checked(servers, t)
  return problem ? { problem } : { scope, servers }
}

const own = (entries: readonly BuffMcp.Entry[]) => entries.filter((entry) => entry.scope !== "builtin")
const nothing = (t: BuffI18n.T): Problem => ({
  problem: t("You have no servers of your own: Buff Code servers are not edited."),
})
const where = (entry: BuffMcp.Entry, t: BuffI18n.T) => (entry.scope === "project" ? t("in the project") : t("with me"))

async function pick(ui: Ui, title: string, entries: readonly BuffMcp.Entry[]) {
  const t = tr(ui)
  const name = await ui.select<string>({
    title,
    options: entries.map((entry) => ({ title: entry.name, value: entry.name, description: where(entry, t) })),
  })
  return entries.find((entry) => entry.name === name)
}

/** Запись открывается как JSON: в консоли это и форма, и вкладка JSON сразу. */
export async function edit(ui: Ui, entries: readonly BuffMcp.Entry[]): Promise<Saved | Problem | undefined> {
  const t = tr(ui)
  const mine = own(entries)
  if (!mine.length) return nothing(t)
  const entry = await pick(ui, t("Which server to edit"), mine)
  if (!entry) return
  const text = await ui.prompt({
    title: t("Server «{name}» (JSON)", { name: entry.name }),
    value: entry.config ? JSON.stringify(entry.config) : "",
  })
  if (text === undefined) return
  const read = BuffMcp.fromJson(text, t)
  if ("problem" in read) return read
  const scope = entry.scope as BuffMcp.Scope
  const servers = read.servers.map((server) => ({ name: server.name ?? entry.name, config: server.config }))
  const problem = checked(servers, t)
  return problem ? { problem } : { scope, servers, previous: { scope, name: entry.name } }
}

export async function remove(ui: Ui, entries: readonly BuffMcp.Entry[]): Promise<Target | Problem | undefined> {
  const t = tr(ui)
  const mine = own(entries)
  if (!mine.length) return nothing(t)
  const entry = await pick(ui, t("Which server to delete"), mine)
  if (!entry) return
  const sure = await ui.confirm({
    title: t("Delete server «{name}»?", { name: entry.name }),
    message: entry.file
      ? t("The entry will be removed from {file}.", { file: entry.file })
      : t("The entry will be removed from the configuration."),
  })
  return sure ? { scope: entry.scope as BuffMcp.Scope, name: entry.name } : undefined
}
