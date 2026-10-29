// Buff (#639): мобильный API машины — команды из конверта телефона поверх серверного API Buff Code
// (тот же сервер, что у окна и консоли; второй реализации логики нет). Телефон — владелец машины,
// но только в известных проектах: новая сессия — проект и модель лишь из списков службы,
// произвольный путь не открывается.
import { RefusalError, type DeviceRecord, type Reply } from "@buff/mobile-protocol"
import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { BuffLocale } from "../locale.js"

/** Запрос к серверу Buff Code внутри процесса; 4xx приходит как RefusalError. */
export type Call = (
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT",
  path: string,
  options?: { query?: Record<string, string | number | undefined>; body?: unknown },
) => Promise<unknown>

interface ProjectInfo {
  id: string
  canonical: string
  name?: string
  time: { updated: number }
}

interface SessionInfo {
  id: string
  parentID?: string
  projectID: string
  title?: string
  time: { created: number; updated: number; archived?: number }
  metadata?: Record<string, unknown>
  model?: { id: string; providerID: string }
  agent?: string
}

interface ModelInfo {
  id: string
  modelID: string
  providerID: string
  name: string
  limit?: { context?: number }
}

interface AgentInfo {
  id: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
}

const data = <T>(reply: unknown): T => (reply as { data: T }).data

const str = (args: Record<string, unknown>, key: string): string => {
  const v = args[key]
  if (typeof v !== "string" || !v.trim()) throw new RefusalError(BuffLocale.t("The field {key} is required", { key }))
  return v.trim()
}

export interface MobileApi {
  run(record: DeviceRecord, op: string, args: unknown): Promise<Reply>
  /** Что телефону знать о сессии сейчас: последние сообщения, идёт ли ход, чего ждёт агент. */
  state(session: string): Promise<SessionState>
}

/** Сырые байты файла по петле (для `files.read`): тип и тело. */
export type Fetch = (route: string, query: Record<string, string>) => Promise<{ mime: string; bytes: Uint8Array }>

/** Терминал каталога сессии на телефоне: вывод уходит пушем, ввод и размер — командами. */
export interface Terminals {
  open(device: string, session: string, directory: string): Promise<{ pty: string }>
  input(device: string, session: string, text: string): Promise<void>
  resize(device: string, session: string, rows: number, cols: number): Promise<void>
  close(device: string, session: string): void
}

/** Подписки телефонов на сессии: события сессии уходят им снимком состояния. */
export interface Watches {
  watch(device: string, session: string): void
  unwatch(device: string, session: string): void
}

export interface SessionState {
  session: string
  running: boolean
  messages: unknown[]
  permissions: unknown[]
  forms: unknown[]
  // Цель сессии (#711): плашка цели на телефоне, как в окне; null — цели нет.
  goal: unknown
}

// Кадр до телефона ограничен: длинный вывод инструмента идёт обрезанным, целиком — по запросу.
const CLIP = 4_000
const clip = (value: unknown): unknown => {
  if (typeof value === "string") return value.length > CLIP ? `${value.slice(0, CLIP)}…` : value
  if (Array.isArray(value)) return value.map(clip)
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]))
  return value
}

/** RPC Buff, которые телефон зовёт как окно: git, побочная беседа, доверие проекта. */
const RPC: Record<string, readonly string[]> = {
  "buff.git": ["state", "branches", "switch", "commit", "push", "message", "log"],
  "buff.side": ["list", "open"],
  "buff.custom": ["list", "review", "trust"],
  "buff.hook": ["list", "review", "trust"],
  // Автоматизации и сценарии (#654) — как в окне.
  "buff.automation": ["list", "save", "remove", "pause", "run", "stop", "runs", "removeRun"],
  "buff.workflow": ["list", "read", "saveMeta", "remove", "start", "runs", "run", "stop", "resume", "answer"],
  // Цель сессии (#711): плашка на телефоне ставит на паузу, продолжает, сбрасывает.
  "buff.goal": ["get", "pause", "resume", "clear"],
}

// Файл до телефона — частями: кадр ретранслятора ограничен. Кратно трём: части в base64 склеиваются
// без заполнителей, и телефон собирает большой файл целиком (#708).
const READ_PART = 96 * 1024

/** Текст ли файл для телефона: по типу; документы офиса (zip, в типе «xml») и PDF — байтами. */
export const BuffMobileText = {
  isText(mime: string, part: Uint8Array): boolean {
    if (/officedocument|opendocument|pdf|zip|msword|ms-excel|ms-powerpoint|^image\/|^audio\/|^video\//.test(mime)) return false
    if (/^text\/|json|xml|javascript|typescript|yaml|toml/.test(mime)) return true
    return !part.includes(0)
  },
}

export function mobileApi(call: Call, watches?: Watches, extra?: { fetch?: Fetch; terminals?: Terminals }): MobileApi {
  const projects = async () =>
    // /api/project отвечает массивом, без обёртки data.
    ((await call("GET", "/api/project")) as ProjectInfo[])
      .slice()
      .sort((a, b) => b.time.updated - a.time.updated)
  const project = async (id: string) => {
    const p = (await projects()).find((x) => x.id === id)
    if (!p) throw new RefusalError(BuffLocale.t("No such project on this machine"))
    return p
  }
  // Сессии проекта, как их показывает окно: без дочерних (сабагенты) и архивных; где начаты и
  // идут ли сейчас.
  const sessionsOf = async (projectID: string, limit: number, cursor?: string) => {
    const [page, active] = await Promise.all([
      call("GET", "/api/session", {
        query: { project: projectID, limit, order: "desc", ...(cursor ? { cursor } : {}) },
      }) as Promise<{ data: SessionInfo[]; cursor?: { next?: string } }>,
      call("GET", "/api/session/active").then(
        (r) => new Set(Object.keys(data<Record<string, unknown>>(r) ?? {})),
        () => new Set<string>(),
      ),
    ])
    return {
      sessions: page.data
        .filter((x) => !x.parentID && !x.time.archived)
        .map((x) => ({
          id: x.id,
          title: x.title ?? "",
          created: x.time.created,
          updated: x.time.updated,
          origin: x.metadata?.origin === "phone" ? "phone" : "window",
          running: active.has(x.id),
        })),
      ...(page.cursor?.next ? { cursor: page.cursor.next } : {}),
    }
  }
  const models = async (directory: string) =>
    data<ModelInfo[]>(await call("GET", "/api/model", { query: { "location[directory]": directory } })) ?? []
  const modelKey = (m: { providerID: string; modelID?: string; id: string }) => `${m.providerID}/${m.modelID ?? m.id}`
  // Агенты, которых человек выбирает сам: без сабагентов и скрытых; plan — это отметка «План».
  const agents = async (directory: string) =>
    (data<AgentInfo[]>(await call("GET", "/api/agent", { query: { "location[directory]": directory } })) ?? []).filter(
      (a) => a.mode !== "subagent" && !a.hidden && a.id !== "plan",
    )
  // Последняя сессия проекта (как в списке: не сабагент, не архив) — с неё новая сессия продолжает
  // модель и агента (#706).
  const lastSession = async (projectID: string) =>
    data<SessionInfo[]>(await call("GET", "/api/session", { query: { project: projectID, limit: 20, order: "desc" } })).find(
      (x) => !x.parentID && !x.time.archived,
    )

  const goalOf = async (session: string): Promise<unknown> => {
    const where = await directoryOf(session).catch(() => undefined)
    if (!where) return null
    const reply = (await call("POST", "/api/rpc/buff.goal/get", {
      query: { "location[directory]": where },
      body: { input: { session } },
    }).catch(() => undefined)) as { output?: { goal?: unknown } } | undefined
    return reply?.output?.goal ?? null
  }

  const state = async (session: string): Promise<SessionState> => {
    const [messages, active, permissions, forms, goal] = await Promise.all([
      call("GET", `/api/session/${session}/message`, { query: { limit: 6, order: "desc" } }),
      call("GET", "/api/session/active").then(
        (r) => Object.keys(data<Record<string, unknown>>(r) ?? {}),
        () => [] as string[],
      ),
      call("GET", `/api/session/${session}/permission`).catch(() => ({ data: [] })),
      call("GET", `/api/session/${session}/form`).catch(() => ({ data: [] })),
      goalOf(session),
    ])
    const list = (r: unknown) => (Array.isArray(r) ? r : (data<unknown[]>(r) ?? []))
    return {
      session,
      running: active.includes(session),
      messages: clip(list(messages)) as unknown[],
      permissions: list(permissions),
      forms: list(forms),
      goal,
    }
  }

  // Файлы с телефона (#652): приходят чанками (как у установок) и уходят в промпт сессии целиком.
  const uploads = new Map<string, { name: string; mime: string; parts: string[]; of: number; at: number }>()
  const UPLOAD_MAX = 20 * 1024 * 1024
  const filesOf = (args: Record<string, unknown>) => {
    const refs = Array.isArray(args.attachments) ? (args.attachments as { upload_id?: unknown }[]) : []
    return refs.map((r) => {
      const u = uploads.get(String(r.upload_id ?? ""))
      if (!u || u.parts.filter((x) => x !== undefined).length !== u.of) throw new RefusalError(BuffLocale.t("The file did not upload completely — attach it again"))
      uploads.delete(String(r.upload_id))
      // The prompt endpoint takes a file as a URI (PromptInput.FileAttachment, #676): inline — a data URL.
      return { uri: `data:${u.mime};base64,${u.parts.join("")}`, name: u.name }
    })
  }

  const directoryOf = async (session: string) =>
    data<{ location: { directory: string } }>(await call("GET", `/api/session/${session}`)).location.directory

  const ops: Record<string, (args: Record<string, unknown>, record: DeviceRecord) => Promise<unknown>> = {
    "session.state": async (args) => state(str(args, "session")),
    // Изменения рабочей копии, как вид «Изменения» окна (vcs.diff mode=working), и ветка.
    "changes.list": async (args) => {
      const where = { "location[directory]": await directoryOf(str(args, "session")) }
      const [diff, vcs] = await Promise.all([
        call("GET", "/api/vcs/diff", { query: { ...where, mode: args.mode === "branch" ? "branch" : "working", context: 3 } }),
        call("GET", "/api/vcs", { query: where }).catch(() => ({ data: {} })),
      ])
      return { files: clip(data<unknown[]>(diff) ?? []), vcs: data<unknown>(vcs) ?? {} }
    },
    "files.list": async (args) => {
      const where = await directoryOf(str(args, "session"))
      const path = typeof args.path === "string" ? args.path.replace(/^\/+/, "") : ""
      if (path.split("/").includes("..")) throw new RefusalError(BuffLocale.t("Only inside the project"))
      return { entries: data<unknown[]>(await call("GET", "/api/fs/list", { query: { "location[directory]": where, path } })) ?? [] }
    },
    // Файл проекта на телефон: только внутри каталога сессии (сервер отказывает в выходе за него), частями.
    "files.read": async (args) => {
      const where = await directoryOf(str(args, "session"))
      const path = str(args, "path").replace(/^\.?\/+/, "")
      if (path.split("/").includes("..")) throw new RefusalError(BuffLocale.t("Only inside the project"))
      if (!extra?.fetch) throw new RefusalError(BuffLocale.t("Reading files is unavailable"))
      const route = `/api/fs/read/${path.split("/").map(encodeURIComponent).join("/")}`
      const { mime, bytes } = await extra.fetch(route, { "location[directory]": where }).catch((err: unknown) => {
        throw new RefusalError(String(err).includes("404") ? BuffLocale.t("No such file") : BuffLocale.t("The file cannot be read — it is outside the project or unavailable"))
      })
      const from = Math.max(0, Number(args.from ?? 0))
      const part = bytes.subarray(from, from + READ_PART)
      const text = args.raw !== true && BuffMobileText.isText(mime, part)
      return {
        path,
        mime,
        size: bytes.length,
        from,
        ...(from + part.length < bytes.length ? { next: from + part.length } : {}),
        ...(text ? { text: new TextDecoder().decode(part) } : { base64: Buffer.from(part).toString("base64") }),
      }
    },
    "terminal.open": async (args, record) => {
      const session = str(args, "session")
      if (!extra?.terminals) throw new RefusalError(BuffLocale.t("The terminal is unavailable"))
      return extra.terminals.open(record.device, session, await directoryOf(session))
    },
    "terminal.input": async (args, record) => {
      await extra?.terminals?.input(record.device, str(args, "session"), String(args.text ?? ""))
      return {}
    },
    "terminal.resize": async (args, record) => {
      await extra?.terminals?.resize(record.device, str(args, "session"), Number(args.rows), Number(args.cols))
      return {}
    },
    "terminal.close": async (args, record) => {
      extra?.terminals?.close(record.device, str(args, "session"))
      return {}
    },
    // RPC Buff — как у окна, только из списка; в каталоге сессии.
    rpc: async (args) => {
      const id = str(args, "id")
      const method = str(args, "method")
      if (!RPC[id]?.includes(method)) throw new RefusalError(`not available from the phone: ${id}.${method}`)
      // Каталог — сессии или проекта: автоматизации и сценарии живут на уровне проекта.
      const where =
        typeof args.session === "string" && args.session
          ? await directoryOf(args.session)
          : (await project(str(args, "project"))).canonical
      const reply = (await call("POST", `/api/rpc/${id}/${method}`, {
        query: { "location[directory]": where },
        body: args.input === undefined ? {} : { input: args.input },
      })) as { output?: unknown }
      return { output: reply?.output ?? null }
    },
    // Палитра сессии: сжать, отменить и вернуть ход, переименовать, сменить агента и модель.
    "session.compact": async (args) => call("POST", `/api/session/${str(args, "session")}/compact`, { body: {} }),
    "session.undo": async (args) => {
      const session = str(args, "session")
      return call("POST", `/api/session/${session}/revert/stage`, { body: { messageID: str(args, "message"), files: true } })
    },
    "session.redo": async (args) => {
      const session = str(args, "session")
      return typeof args.message === "string"
        ? call("POST", `/api/session/${session}/revert/stage`, { body: { messageID: args.message, files: true } })
        : call("DELETE", `/api/session/${session}/revert`)
    },
    "session.rename": async (args) => call("PATCH", `/api/session/${str(args, "session")}`, { body: { title: str(args, "title") } }),
    // Режим разрешений сессии — правила, как у окна (BuffPermissionMode.rules).
    "session.mode": async (args) => {
      const mode = args.mode === "edit" || args.mode === "full" ? args.mode : "ask"
      return call("PATCH", `/api/session/${str(args, "session")}`, {
        body: { permissions: BuffPermissionMode.rules(mode, args.plan === true) },
      })
    },
    "session.agent": async (args) => call("POST", `/api/session/${str(args, "session")}/agent`, { body: { agent: str(args, "agent") } }),
    "session.model": async (args) => {
      const [providerID, ...rest] = str(args, "model").split("/")
      return call("POST", `/api/session/${str(args, "session")}/model`, { body: { model: { id: rest.join("/"), providerID } } })
    },
    attachment_upload: async (args) => {
      const id = str(args, "id")
      const seq = Number(args.seq)
      const of = Number(args.of)
      if (!Number.isInteger(seq) || !Number.isInteger(of) || seq < 0 || seq >= of) throw new RefusalError(BuffLocale.t("A wrong part of the file"))
      for (const [key, u] of uploads) if (Date.now() - u.at > 30 * 60_000) uploads.delete(key)
      const u = uploads.get(id) ?? { name: String(args.name ?? "file"), mime: String(args.mime ?? "application/octet-stream"), parts: [], of, at: Date.now() }
      u.parts[seq] = typeof args.data === "string" ? args.data : ""
      if (u.parts.reduce((n, x) => n + (x?.length ?? 0), 0) > UPLOAD_MAX) {
        uploads.delete(id)
        throw new RefusalError(BuffLocale.t("The file is larger than 20 MB"))
      }
      uploads.set(id, u)
      return {}
    },
    // Команды и навыки, которые есть у сессии (её каталог), — для «/» в композере.
    "commands.list": async (args) => {
      const where = await directoryOf(str(args, "session"))
      const query = { "location[directory]": where }
      const [commands, skills] = await Promise.all([
        call("GET", "/api/command", { query }).then((r) => data<{ name: string; description?: string }[]>(r) ?? []),
        call("GET", "/api/skill", { query }).then(
          (r) => data<{ id: string; name: string; description?: string }[]>(r) ?? [],
          () => [],
        ),
      ])
      return {
        commands: [
          ...commands.map((c) => ({ name: c.name, description: c.description ?? "", source: "builtin" })),
          ...skills.map((k) => ({ name: k.name, id: k.id, description: k.description ?? "", source: "skill" })),
        ],
      }
    },
    "commands.run": async (args) => {
      const session = str(args, "session")
      if (args.source === "skill")
        return call("POST", `/api/experimental/session/${session}/skill`, { body: { id: str(args, "id") } })
      return call("POST", `/api/session/${session}/command`, {
        body: { name: str(args, "name"), text: typeof args.text === "string" ? args.text : "" },
      })
    },
    // Следить за сессией: пока телефон смотрит её, изменения приходят сами, данными.
    "session.watch": async (args, record) => {
      const session = str(args, "session")
      watches?.watch(record.device, session)
      return state(session)
    },
    "session.unwatch": async (args, record) => {
      watches?.unwatch(record.device, str(args, "session"))
      return {}
    },
    "projects.list": async () => ({
      projects: await Promise.all(
        (await projects()).map(async (p) => ({
          id: p.id,
          name: p.name ?? p.canonical.split("/").pop() ?? p.canonical,
          directory: p.canonical,
          updated: p.time.updated,
          sessions: (await sessionsOf(p.id, 200)).sessions.length,
        })),
      ),
    }),
    // default — модель последней сессии проекта, пока она есть на машине, иначе модель по умолчанию.
    "models.list": async (args) => {
      const p = await project(str(args, "project"))
      const [list, last] = await Promise.all([models(p.canonical), lastSession(p.id)])
      const keys = list.map(modelKey)
      const recent = last?.model ? modelKey(last.model) : undefined
      const fallback = async () => {
        const m = data<ModelInfo | undefined>(
          await call("GET", "/api/model/default", { query: { "location[directory]": p.canonical } }),
        )
        return m && keys.includes(modelKey(m)) ? modelKey(m) : keys[0]
      }
      const chosen = recent && keys.includes(recent) ? recent : await fallback()
      return {
        models: list.map((m) => ({
          id: modelKey(m),
          name: m.name,
          provider: m.providerID,
          ...(m.limit?.context ? { context: m.limit.context } : {}),
        })),
        ...(chosen ? { default: chosen } : {}),
      }
    },
    // default — агент последней сессии проекта, пока он в списке, иначе первый (агент по умолчанию).
    "agents.list": async (args) => {
      const p = await project(str(args, "project"))
      const [list, last] = await Promise.all([agents(p.canonical), lastSession(p.id)])
      const chosen = list.find((a) => a.id === last?.agent) ?? list[0]
      return {
        agents: list.map((a) => ({ id: a.id, ...(a.description ? { description: a.description } : {}) })),
        ...(chosen ? { default: chosen.id } : {}),
      }
    },
    "sessions.list": async (args) => {
      const p = await project(str(args, "project"))
      return sessionsOf(p.id, Number(args.limit ?? 50), typeof args.cursor === "string" ? args.cursor : undefined)
    },
    "session.get": async (args) => call("GET", `/api/session/${str(args, "session")}`),
    // Страница таймлайна: первая — новые сверху (order=desc), дальше — по курсору назад (без order:
    // сервер не принимает оба сразу).
    "session.messages": async (args) =>
      clip(
        await call("GET", `/api/session/${str(args, "session")}/message`, {
          query: {
            limit: Number(args.limit ?? 50),
            ...(typeof args.cursor === "string" ? { cursor: args.cursor } : { order: args.order === "asc" ? "asc" : "desc" }),
          },
        }),
      ),
    // Новая сессия: проект и модель — только из списков машины.
    "session.new": async (args, record) => {
      const p = await project(str(args, "project"))
      const wanted = str(args, "model")
      const model = (await models(p.canonical)).find((m) => modelKey(m) === wanted)
      if (!model) throw new RefusalError(BuffLocale.t("No such model in this Buff Code"))
      const agent = typeof args.agent === "string" && args.agent ? args.agent : undefined
      if (agent && !(await agents(p.canonical)).some((a) => a.id === agent))
        throw new RefusalError(BuffLocale.t("No such agent in this Buff Code"))
      // Режим разрешений и «план» — как у окна: правила сессии и агент plan (он важнее выбранного).
      const mode = args.mode === "edit" || args.mode === "full" ? args.mode : "ask"
      const plan = args.plan === true
      const created = data<{ id: string }>(
        await call("POST", "/api/session", {
          body: {
            model: { id: model.modelID, providerID: model.providerID },
            location: { directory: p.canonical },
            metadata: { origin: "phone", device: record.display },
            permissions: BuffPermissionMode.rules(mode, plan),
            ...(plan ? { agent: "plan" } : agent ? { agent } : {}),
          },
        }),
      )
      const text = typeof args.prompt === "string" ? args.prompt.trim() : ""
      const files = filesOf(args)
      if (text || files.length)
        await call("POST", `/api/session/${created.id}/prompt`, {
          body: { text, metadata: { source: "phone" }, ...(files.length ? { files } : {}) },
        })
      return { session: created }
    },
    "session.prompt": async (args) => {
      const files = filesOf(args)
      const text = typeof args.text === "string" ? args.text.trim() : ""
      if (!text && !files.length) throw new RefusalError(BuffLocale.t("A text or a file is required"))
      return call("POST", `/api/session/${str(args, "session")}/prompt`, {
        body: { text, metadata: { source: "phone" }, ...(files.length ? { files } : {}) },
      })
    },
    "session.abort": async (args) =>
      call("POST", `/api/session/${str(args, "session")}/interrupt`, { body: {} }),
    "permission.answer": async (args) => {
      const decision = args.decision
      if (decision !== "once" && decision !== "always" && decision !== "reject")
        throw new RefusalError(BuffLocale.t("The decision is once, always or reject"))
      return call("POST", `/api/session/${str(args, "session")}/permission/${str(args, "request")}/reply`, {
        body: { decision, ...(typeof args.message === "string" ? { message: args.message } : {}) },
      })
    },
    // «Не сейчас» на форме MCP: форма отменяется, ход продолжается без ответа.
    "question.cancel": async (args) =>
      call("DELETE", `/api/session/${str(args, "session")}/form/${str(args, "form")}`),
    "question.answer": async (args) =>
      call("POST", `/api/session/${str(args, "session")}/form/${str(args, "form")}/reply`, {
        body: { answer: args.answer ?? {} },
      }),
  }

  return {
    state,
    async run(record, op, args) {
      const handler = ops[op]
      if (!handler) throw new RefusalError(`not available from the phone: ${op}`)
      const input = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
      const result = await handler(input, record)
      return { ok: true, ...(typeof result === "object" && result !== null ? (result as object) : { result }) }
    },
  }
}
