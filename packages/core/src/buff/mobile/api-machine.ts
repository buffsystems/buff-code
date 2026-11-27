// Buff (#969): что машина говорит о себе и один список чатов по всем проектам. Клиент узнаёт по
// `machine.info` уровень API (движок без этой команды отвечает отказом — это уровень 1) и дом
// машины: чат без проекта идёт в нём, поэтому проект дома клиент за проект не показывает.
import path from "node:path"
import type { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import { data, rpc, type Kit, type Machine, type MachineLimits, type Ops } from "./api-kit.js"

/** Уровень API машины: 2 — команды веб-клиента (#969), 3 — плагины чатов `plugins.*` (#595). */
export const API_LEVEL = 3
/** Папка проектов в доме машины. */
export const PROJECTS_DIR = "projects"

// Пределы машины, пока оператор не прислал своих: те же значения, что у настроек установки
// (f/config/chat_*). На облачной машине их заменяет BUFF_CLOUD_LIMITS.
const LIMITS: MachineLimits = { uploadMaxBytes: 20 * 1024 * 1024, memoryMaxChars: 8000, mcpServersMax: 10 }

const whole = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback

/** Машина по окружению: BUFF_CLOUD=1 — облачная; BUFF_CLOUD_LIMITS — JSON пределов от оператора. */
export function machineOf(env: Record<string, string | undefined>, home: string): Machine {
  const sent = (() => {
    try {
      const parsed: unknown = JSON.parse(env.BUFF_CLOUD_LIMITS || "{}")
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  })()
  return {
    home,
    cloud: env.BUFF_CLOUD === "1",
    limits: {
      uploadMaxBytes: whole(sent.uploadMaxBytes, LIMITS.uploadMaxBytes) || LIMITS.uploadMaxBytes,
      memoryMaxChars: whole(sent.memoryMaxChars, LIMITS.memoryMaxChars) || LIMITS.memoryMaxChars,
      mcpServersMax: whole(sent.mcpServersMax, LIMITS.mcpServersMax),
    },
  }
}

export const projectsRoot = (machine: Machine) => path.join(machine.home, PROJECTS_DIR)

interface ChatRow {
  id: string
  parentID?: string
  projectID: string
  title?: string
  fork?: { sessionID: string }
  time: { created: number; updated: number; archived?: number }
}

export function machineOps(kit: Kit): Ops {
  const pending = (route: string, directory: string) =>
    kit.call("GET", route, { query: { "location[directory]": directory } }).then(
      (r) => {
        const got = data<unknown>(r)
        return (Array.isArray(got) ? (got as { sessionID?: string }[]) : []).flatMap((x) =>
          x.sessionID ? [x.sessionID] : [],
        )
      },
      () => [] as string[],
    )
  return {
    "machine.info": async () => ({
      api: API_LEVEL,
      cloud: kit.machine.cloud,
      home: await kit.home(),
      projectsRoot: projectsRoot(kit.machine),
      limits: kit.machine.limits,
      // Часы машины (R15-01): на облачной — пояс человека (TZ); расписание без своего пояса — по ним.
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    // Чаты всех проектов одним списком, свежие первыми. `project` не назван — все; null — только
    // вне проектов; id — этого проекта. Сабагенты и побочные диалоги в список не входят.
    "chats.list": async (args) => {
      const home = await kit.home()
      const wanted = args.project === null ? home.project : typeof args.project === "string" ? args.project : undefined
      if (wanted && wanted !== home.project) await kit.project(wanted)
      const [page, active, marks] = await Promise.all([
        kit.call("GET", "/api/session", {
          query: {
            ...(wanted ? { project: wanted } : {}),
            limit: Number(args.limit ?? 50),
            order: "desc",
            ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
          },
        }) as Promise<{ data: ChatRow[]; cursor?: { next?: string } }>,
        kit.call("GET", "/api/session/active").then(
          (r) => new Set(Object.keys(data<Record<string, unknown>>(r) ?? {})),
          () => new Set<string>(),
        ),
        rpc<BuffSessionMarks.State | undefined>(kit, home.directory, "buff.session-marks", "get").catch(
          () => undefined,
        ),
      ])
      const rows = page.data ?? []
      // Кого ждут — разрешения или ответа, своего или сабагента: по каталогам проектов страницы.
      const known = await kit.projects().catch(() => [])
      const directories = [...new Set(rows.map((x) => x.projectID))].map((id) =>
        id === home.project ? home.directory : known.find((p) => p.id === id)?.canonical,
      )
      const asked = (
        await Promise.all(
          directories.flatMap((d) => (d ? [pending("/api/permission/request", d), pending("/api/form", d)] : [])),
        )
      ).flat()
      const parent = new Map(rows.flatMap((x) => (x.parentID ? [[x.id, x.parentID] as const] : [])))
      const waiting = new Set(asked.map((id) => parent.get(id) ?? id))
      const pinned = new Set(marks?.pinned ?? [])
      const away = new Set(marks?.archived ?? [])
      const sides = new Set(marks?.sides ?? [])
      const archived = args.archived === true
      return {
        chats: rows
          .filter((x) => !x.parentID && !sides.has(x.id))
          .filter((x) => (Boolean(x.time.archived) || away.has(x.id)) === archived)
          .map((x) => ({
            id: x.id,
            title: x.title ?? "",
            project: x.projectID === home.project ? null : x.projectID,
            created: x.time.created,
            updated: x.time.updated,
            running: active.has(x.id),
            ...(waiting.has(x.id) ? { waiting: true } : {}),
            ...(pinned.has(x.id) ? { pinned: true } : {}),
            ...(x.fork?.sessionID ? { branchOf: x.fork.sessionID } : {}),
          })),
        ...(page.cursor?.next ? { cursor: page.cursor.next } : {}),
      }
    },
  }
}
