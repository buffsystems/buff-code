// Buff (#969): проекты облачной машины. Проект веб-клиента — папка в `~/projects` и проект движка
// по ней: её заводят, называют, красят и удаляют отсюда. Папки для удалённого клиента создаёт и
// удаляет только облачная машина — там дом человека и есть его хранилище; на своём компьютере
// клиент по-прежнему работает только в известных проектах.
import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { BuffProjectSlug } from "@opencode/schema/buff-project-slug"
import { data, str, type Kit, type Ops, type ProjectRow } from "./api-kit.js"
import { projectsRoot } from "./api-machine.js"
import { phoneRefusal } from "./refusal.js"

interface SessionRow {
  id: string
  parentID?: string
}

const shown = (p: ProjectRow) => ({
  id: p.id,
  name: p.name ?? p.canonical.split("/").pop() ?? p.canonical,
  ...(p.icon?.color ? { color: p.icon.color } : {}),
  directory: p.canonical,
})

export function projectOps(
  kit: Kit,
  /** Что страница проекта говорит сверх проекта и числа чатов: инструкции и память. */
  home: (directory: string) => Promise<Record<string, unknown>> = async () => ({}),
): Ops {
  const root = projectsRoot(kit.machine)
  const cloudOnly = () => {
    if (!kit.machine.cloud) throw phoneRefusal("Available on a cloud machine only")
  }
  // Проект, который можно менять: не дом машины (чаты вне проектов — не проект).
  const own = async (args: Record<string, unknown>) => {
    const p = await kit.project(str(args, "project"))
    if (p.id === (await kit.home()).project) throw phoneRefusal("Chats outside projects are not a project to change")
    return p
  }
  // Все сессии проекта, страница за страницей: и сабагенты, и архивные.
  const sessionsOf = async (project: string) => {
    const all: SessionRow[] = []
    let cursor: string | undefined
    do {
      const page = (await kit.call("GET", "/api/session", {
        query: { project, limit: 200, order: "desc", ...(cursor ? { cursor } : {}) },
      })) as { data?: SessionRow[]; cursor?: { next?: string } }
      const rows = page.data ?? []
      all.push(...rows)
      cursor = rows.length ? page.cursor?.next : undefined
    } while (cursor)
    return all
  }
  const patch = async (id: string, args: Record<string, unknown>) => {
    const name = typeof args.name === "string" ? args.name.trim() : undefined
    const color = typeof args.color === "string" ? args.color.trim() : undefined
    return (await kit.call("PATCH", `/api/project/${encodeURIComponent(id)}`, {
      body: { ...(name ? { name } : {}), ...(color !== undefined ? { icon: { color } } : {}) },
    })) as ProjectRow
  }
  return {
    "project.create": async (args) => {
      cloudOnly()
      const name = str(args, "name")
      await mkdir(root, { recursive: true })
      const directory = path.join(root, BuffProjectSlug.of(name, await readdir(root)))
      await mkdir(directory)
      // Проект движка — по папке. Если дом человека сам стал репозиторием, любая папка в нём —
      // часть того же проекта: отдельного не получится, и папка не остаётся.
      const at = (await kit
        .call("GET", "/api/location", { query: { "location[directory]": directory } })
        .catch(() => undefined)) as { project?: { id: string; canonical: string } } | undefined
      if (!at?.project || at.project.canonical !== directory) {
        await rm(directory, { recursive: true, force: true })
        throw phoneRefusal(
          "A project cannot be made here: the home folder is itself a repository, and every folder inside belongs to it",
        )
      }
      return { project: shown({ ...(await patch(at.project.id, { ...args, name })), canonical: directory }) }
    },
    // Название и цвет; папка не переименовывается — на неё ссылаются чаты.
    "project.update": async (args) => {
      const p = await own(args)
      return { project: shown({ ...(await patch(p.id, args)), canonical: p.canonical }) }
    },
    "project.get": async (args) => {
      const p = await kit.project(str(args, "project"))
      // Память не прочиталась — страница проекта всё равно открывается.
      const [sessions, more] = await Promise.all([sessionsOf(p.id), home(p.canonical).catch(() => ({}))])
      return { project: shown(p), chats: sessions.filter((s) => !s.parentID).length, ...more }
    },
    // Проект уходит вместе с папкой. Его чаты — по выбору человека: удалить или оставить вне
    // проектов (тогда они сначала переносятся в дом машины). Работающий чат останавливает удаление.
    "project.remove": async (args) => {
      cloudOnly()
      const p = await own(args)
      if (path.dirname(p.canonical) !== root) throw phoneRefusal("Only a project made here can be removed here")
      if (args.chats !== "delete" && args.chats !== "keep")
        throw phoneRefusal("Choose what happens to the project's chats: delete or keep")
      const [sessions, active, home] = await Promise.all([
        sessionsOf(p.id),
        kit.call("GET", "/api/session/active").then(
          (r) => new Set(Object.keys(data<Record<string, unknown>>(r) ?? {})),
          () => new Set<string>(),
        ),
        kit.home(),
      ])
      if (sessions.some((s) => active.has(s.id)))
        throw phoneRefusal("The chat is working — wait for it to finish or stop it")
      // Сначала основные чаты: сервер удаляет чат вместе с его сабагентами.
      const ordered = [...sessions.filter((s) => !s.parentID), ...sessions.filter((s) => s.parentID)]
      for (const s of args.chats === "keep" ? ordered : ordered.filter((x) => !x.parentID)) {
        if (args.chats === "keep") await kit.call("POST", `/api/session/${s.id}/move`, { body: { directory: home.directory } })
        else await kit.call("DELETE", `/api/session/${s.id}`)
      }
      await kit.call("DELETE", `/api/project/${encodeURIComponent(p.id)}`)
      await rm(p.canonical, { recursive: true, force: true })
      return {}
    },
  }
}
