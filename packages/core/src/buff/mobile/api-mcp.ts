// Buff (#969): подключения человека — его MCP-серверы — из веб-клиента. Только удалённые (адрес и,
// если нужно, заголовки): локальный сервер — это команда на машине, её по-прежнему пишут в файл
// конфигурации руками. Запись идёт в конфигурацию пользователя (`buff.mcp`, область user): ядро
// перечитывает её и подключает сервер на лету, а правило машины «mcp:user» разрешает его
// инструменты сразу — перезапуск не нужен. Значения заголовков машину не покидают.
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { BuffMcpRules } from "../mcp-rules.js"
import { rpc, str, type Kit, type Ops } from "./api-kit.js"
import { phoneRefusal } from "./refusal.js"

/** Сервер службы, а не человека: виден, но не правится. */
const MANAGED = ["draw"]

// Имена, которыми начинаются действия службы: инструмент сервера с таким именем назывался бы как
// её действие (`external` + `directory` — `external_directory`), а машины до правил «mcp:user»
// разрешали серверы правилом «<сервер>_*», открывавшим и сами действия.
const RESERVED = [
  ...MANAGED,
  ...["session", "workflow", "external", "send", "todo", "plan", "memory", "question"],
  ...["read", "glob", "grep", "skill", "shell", "edit", "subagent", "webfetch", "websearch", "execute", "search", "goal"],
]

/** Занято ли имя службой — по тому, как движок называет пространство имён сервера. */
export function reservedName(name: string): boolean {
  return RESERVED.includes(name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase())
}

type Entry = BuffMcp.Entry

export function mcpOps(kit: Kit): Ops {
  const entries = async () =>
    (await rpc<Entry[] | undefined>(kit, (await kit.home()).directory, "buff.mcp", "list")) ?? []
  const managed = (entry: Entry) => entry.scope === "builtin" || MANAGED.includes(entry.name)
  // Что клиент видит: серверы человека и службы. Серверы из файлов проектов — не его настройка здесь.
  const visible = (entry: Entry) => entry.scope === "user" || entry.scope === "builtin"
  const own = async (name: string) => {
    const entry = (await entries()).find((item) => visible(item) && item.name === name)
    if (!entry) throw phoneRefusal("No such connection")
    if (managed(entry)) throw phoneRefusal("This connection is managed by the service")
    return entry
  }
  const change = async (method: string, input: Record<string, unknown>) => {
    await rpc(kit, (await kit.home()).directory, "buff.mcp", method, input)
    // Поле — для клиентов, ждавших перезапуска машины: его больше нет, состояние видно в списке.
    return { restart: false }
  }
  return {
    "mcp.servers": async () => {
      const list = (await entries()).filter(visible)
      // Сверх предела оператора (R15-02): машина открывает лишь первых по имени — экран говорит какие.
      // Первые — добавленные человеком, в их порядке (R16-02), остальные — по имени.
      const own = list.filter((entry) => !managed(entry))
      const order = own
        .filter((entry) => entry.added !== undefined)
        .toSorted((a, b) => a.added! - b.added!)
        .map((entry) => entry.name)
      const over = kit.machine.cloud
        ? BuffMcpRules.overLimit(
            own.map((entry) => entry.name),
            kit.machine.limits.mcpServersMax,
            order,
          )
        : new Set<string>()
      return {
        servers: list.map((entry) => {
          const remote = entry.config?.type === "remote" ? entry.config : undefined
          const service = managed(entry)
          return {
            name: entry.name,
            scope: service ? "builtin" : "user",
            type: entry.config?.type ?? "remote",
            // Адрес сервера службы — её внутренний; человеку он ни к чему.
            ...(remote && !service ? { url: remote.url } : {}),
            enabled: entry.status.status !== "disabled",
            status: entry.status.status,
            managed: service,
            ...(remote?.headers && Object.keys(remote.headers).length && !service ? { hasHeaders: true } : {}),
            ...(over.has(entry.name) ? { over: true } : {}),
          }
        }),
        max: kit.machine.limits.mcpServersMax,
      }
    },
    "mcp.save": async (args) => {
      const name = str(args, "name")
      const url = str(args, "url")
      if (reservedName(name)) throw phoneRefusal("The name «{name}» is taken by the service — choose another.", { name })
      // Слова проверки имени — общие с окном (английские исходники каталога).
      let problem: [string, Record<string, string | number> | undefined] | undefined
      BuffMcp.nameProblem(name, (text, params) => ((problem = [text, params as never]), text))
      if (problem) throw phoneRefusal(problem[0], problem[1])
      if (!/^https?:\/\/\S+$/i.test(url)) throw phoneRefusal("The address starts with https:// or http://")
      const all = (await entries()).filter((entry) => entry.scope === "user" && !managed(entry))
      const previous = typeof args.previous === "string" && args.previous.trim() ? args.previous.trim() : undefined
      const known = all.find((entry) => entry.name === (previous ?? name))
      if (previous && !known) throw phoneRefusal("No such connection")
      const max = kit.machine.limits.mcpServersMax
      if (!known && all.length >= max) throw phoneRefusal("No more connections can be added: the limit is {n}", { n: max })
      // Заголовки клиент не видел: правка без них оставляет прежние, пустой набор — убирает.
      const sent =
        typeof args.headers === "object" && args.headers !== null
          ? Object.fromEntries(
              Object.entries(args.headers as Record<string, unknown>).flatMap(([key, value]) =>
                typeof value === "string" && key.trim() ? [[key.trim(), value] as const] : [],
              ),
            )
          : undefined
      const kept = known?.config?.type === "remote" ? known.config.headers : undefined
      const headers = sent ?? kept
      return change("save", {
        scope: "user",
        name,
        config: { type: "remote", url, ...(headers && Object.keys(headers).length ? { headers } : {}) },
        ...(previous && previous !== name ? { previous: { scope: "user", name: previous } } : {}),
      })
    },
    "mcp.remove": async (args) => change("remove", { scope: "user", name: (await own(str(args, "name"))).name }),
    "mcp.enable": async (args) =>
      change("enable", { scope: "user", name: (await own(str(args, "name"))).name, enabled: args.enabled === true }),
  }
}
