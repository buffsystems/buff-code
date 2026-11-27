// Buff (#969): что человек делает с чатом из списка — удалить, перенести в проект и из него,
// закрепить, убрать в архив, ответвить, выгрузить файлом — и поиск по сказанному.
import { BuffExport } from "@opencode/schema/buff-export"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffSearch } from "@opencode/schema/buff-search"
import { BuffLocale } from "../locale.js"
import { data, rpc, str, type Kit, type Ops } from "./api-kit.js"
import { phoneRefusal } from "./refusal.js"

/** Переводчик на язык команды (`args.lang`); без языка — язык машины. */
export const languageOf = (args: Record<string, unknown>): BuffI18n.T =>
  args.lang === "ru" || args.lang === "en" ? (text, params) => BuffI18n.t(args.lang as "ru" | "en", text, params) : BuffLocale.t

/** Каталог чата → его проект для клиента: null — вне проектов (дом машины и всё, что не проект). */
export function projectOfDirectory(
  directory: string | undefined,
  home: { project: string; directory: string },
  projects: readonly { id: string; canonical: string }[],
): string | null {
  if (!directory || directory === home.directory) return null
  // Самый глубокий проект, внутри которого лежит каталог: чат мог начаться в его подпапке.
  const inside = projects
    .filter((p) => p.id !== home.project && (directory === p.canonical || directory.startsWith(`${p.canonical}/`)))
    .toSorted((a, b) => b.canonical.length - a.canonical.length)[0]
  return inside?.id ?? null
}

export function chatOps(kit: Kit): Ops {
  const running = async (session: string) =>
    kit.call("GET", "/api/session/active").then(
      (r) => Object.hasOwn(data<Record<string, unknown>>(r) ?? {}, session),
      () => false,
    )
  const mark = async (type: "pin" | "archive", args: Record<string, unknown>) => {
    const home = await kit.home()
    await rpc(kit, home.directory, "buff.session-marks", "change", {
      type,
      sessionID: str(args, "session"),
      on: args.on === true,
    })
    return {}
  }
  return {
    "session.remove": async (args) => {
      await kit.call("DELETE", `/api/session/${str(args, "session")}`)
      return {}
    },
    // Перенос в проект или из него (project: null — в дом машины). Работающий чат не переносится:
    // его ход идёт в прежней папке.
    "session.move": async (args) => {
      const session = str(args, "session")
      const directory = args.project === null ? (await kit.home()).directory : (await kit.project(str(args, "project"))).canonical
      if (await running(session)) throw phoneRefusal("The chat is working — wait for it to finish or stop it")
      await kit.call("POST", `/api/session/${session}/move`, { body: { directory } })
      return {}
    },
    "session.pin": (args) => mark("pin", args),
    "session.archive": (args) => mark("archive", args),
    // Ветка: история до сообщения (вся, если оно не названо) — новым чатом с именем по исходному.
    "session.fork": async (args) => {
      const session = str(args, "session")
      const made = data<{ id: string; title?: string }>(
        await kit.call("POST", `/api/session/${session}/fork`, {
          body: typeof args.before === "string" && args.before ? { before: args.before } : {},
        }),
      )
      const from = data<{ title?: string }>(await kit.call("GET", `/api/session/${session}`).catch(() => ({ data: {} })))
      const title = languageOf(args)("Branch: {title}", { title: from?.title || made.title || "" }).trim()
      await kit.call("PATCH", `/api/session/${made.id}`, { body: { title } }).catch(() => undefined)
      return { session: { id: made.id } }
    },
    "session.export": async (args) => {
      const format = BuffExport.FORMATS.find((known) => known === args.format)
      if (!format) throw phoneRefusal("The format is md or json")
      const transfer = data<BuffExport.Transfer>(
        await kit.call("GET", `/api/experimental/session/${str(args, "session")}/export`),
      )
      const title = typeof transfer?.info?.title === "string" ? transfer.info.title : ""
      return {
        name: BuffExport.fileName(title, format),
        mime: BuffExport.MIME[format],
        text:
          format === "md"
            ? BuffExport.markdown(transfer, languageOf(args))
            : JSON.stringify(BuffExport.json(transfer), null, 2),
      }
    },
    // Поиск по тексту переписки; слишком короткий запрос — пустая выдача, без отказа: клиент
    // ищет по мере набора.
    search: async (args) => {
      const query = typeof args.query === "string" ? args.query : ""
      if (BuffSearch.problem(query)) return { results: [] }
      const home = await kit.home()
      const [found, projects] = await Promise.all([
        rpc<BuffSearch.Result[] | undefined>(kit, home.directory, "buff.search", "sessions", { query: query.trim() }),
        kit.projects().catch(() => []),
      ])
      return {
        results: (found ?? []).map((hit) => ({
          session: hit.sessionID,
          title: hit.title ?? "",
          project: projectOfDirectory(hit.directory, home, projects),
          message: hit.messageID,
          role: hit.role,
          time: hit.time,
          fragment: hit.fragment,
          more: hit.more,
        })),
      }
    },
  }
}
