// Buff (#969): хранилище человека на облачной машине — её дом целиком. Клиент листает его, читает
// и пишет файлы, заводит и убирает папки; на своём компьютере эти команды отказывают — там телефон
// по-прежнему видит только известные проекты. Здесь же «Результаты»: файлы, которые агент отдал.
//
// Граница — дом машины: путь не выходит из него ни точками, ни абсолютным адресом, ни ссылкой
// (проверяется настоящий путь, как у `send_file`). Настройки и переписка Buff Code (`.config`,
// `.local`) читаются, но отсюда не меняются.
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile, open } from "node:fs/promises"
import path from "node:path"
import type { BuffArtifacts } from "@opencode/schema/buff-artifacts"
import { BuffSendFile } from "@opencode/schema/buff-send-file"
import { Effect } from "effect"
import * as Photon from "../../image/photon.js"
import { rpc, str, type Kit, type Ops } from "./api-kit.js"
import { projectOfDirectory } from "./api-chats.js"
import { phoneRefusal } from "./refusal.js"

/** Что отсюда не меняется: настройки и переписка Buff Code. */
const GUARDED = [".config", ".local"]

/** Абсолютный путь внутри `home` для того, что назвал клиент; undefined — путь из дома выходит. */
export function insideHome(home: string, given: string): string | undefined {
  if (given.includes("\0")) return undefined
  const whole = path.resolve(home, given.startsWith("/") ? given : `./${given}`)
  return whole === home || whole.startsWith(`${home}/`) ? whole : undefined
}

/** Меняется ли путь отсюда: всё, кроме настроек и переписки Buff Code — и самого дома. */
export function changeable(home: string, whole: string): boolean {
  const first = path.relative(home, whole).split("/")[0] ?? ""
  return first !== "" && !GUARDED.includes(first)
}

/** Часть файла для клиента — как у `files.read`: текст текстом, остальное base64; `next` — откуда дальше. */
export async function readPart(
  whole: string,
  shown: string,
  args: Record<string, unknown>,
  part: number,
  isText: (mime: string, bytes: Uint8Array) => boolean,
) {
  const info = await stat(whole).catch(() => undefined)
  if (!info?.isFile()) throw phoneRefusal("No such file")
  const from = Math.max(0, Number(args.from ?? 0) || 0)
  const handle = await open(whole, "r")
  try {
    const buffer = Buffer.alloc(Math.max(0, Math.min(part, info.size - from)))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
    const bytes = buffer.subarray(0, bytesRead)
    const mime = BuffSendFile.mimeOf(whole)
    const text = args.raw !== true && isText(mime, bytes)
    return {
      path: shown,
      mime,
      size: info.size,
      from,
      ...(from + bytes.length < info.size ? { next: from + bytes.length } : {}),
      ...(text ? { text: new TextDecoder().decode(bytes) } : { base64: bytes.toString("base64") }),
    }
  } finally {
    await handle.close()
  }
}

/** A preview: its longest side and its size, small enough for one relay reply. */
const THUMB_SIDE = 480
const THUMB_BASE64 = 80 * 1024
/** A picture larger than this is not decoded for a preview. */
const THUMB_SOURCE_MAX = 32 * 1024 * 1024
/** The resizer, loaded once: the photon wasm the model's pictures already go through. */
let resizer: Promise<Effect.Success<typeof Photon.make>> | undefined

/** A picture made small (#969): a card of «Результаты» draws it without the whole original. */
export async function thumbnail(whole: string, shown: string) {
  const info = await stat(whole).catch(() => undefined)
  if (!info?.isFile()) throw phoneRefusal("No such file")
  const mime = BuffSendFile.mimeOf(whole)
  if (!mime.startsWith("image/") || info.size > THUMB_SOURCE_MAX) throw phoneRefusal("No preview for this file")
  resizer ??= Effect.runPromise(Photon.make)
  const normalize = await resizer
  const content = { uri: shown, content: (await readFile(whole)).toString("base64"), encoding: "base64" as const, mime }
  const small = await Effect.runPromise(
    normalize(shown, content, { autoResize: true, maxWidth: THUMB_SIDE, maxHeight: THUMB_SIDE, maxBase64Bytes: THUMB_BASE64 }),
  ).catch(() => undefined)
  if (!small) throw phoneRefusal("No preview for this file")
  return { path: shown, mime: small.mime, base64: small.content }
}

export function storageOps(
  kit: Kit,
  extra: { part: number; isText: (mime: string, bytes: Uint8Array) => boolean },
): Ops {
  const home = kit.machine.home
  const cloudOnly = () => {
    if (!kit.machine.cloud) throw phoneRefusal("Available on a cloud machine only")
  }
  // Настоящий путь самого глубокого существующего предка: ссылка, ведущая из дома, — отказ.
  const real = async (whole: string): Promise<void> => {
    const root = await realpath(home)
    for (let at = whole; ; at = path.dirname(at)) {
      const resolved = await realpath(at).catch(() => undefined)
      if (resolved === undefined) {
        if (at === path.dirname(at)) break
        continue
      }
      if (resolved !== root && !resolved.startsWith(`${root}/`)) throw phoneRefusal("Only inside your storage")
      return
    }
  }
  const place = async (args: Record<string, unknown>, key = "path", change = false): Promise<string> => {
    cloudOnly()
    const given = typeof args[key] === "string" ? (args[key] as string) : ""
    const whole = insideHome(home, given || ".")
    if (!whole) throw phoneRefusal("Only inside your storage")
    await real(whole)
    if (change && !changeable(home, whole))
      throw phoneRefusal("This folder holds settings and cannot be changed here")
    return whole
  }
  const shown = (whole: string) => path.relative(home, whole)
  return {
    "storage.list": async (args) => {
      const whole = await place(args)
      const names = await readdir(whole).catch(() => {
        throw phoneRefusal("No such folder")
      })
      const entries = (
        await Promise.all(
          names
            // `lost+found` — служебная папка тома, а не файл человека.
            .filter((name) => name !== "lost+found" && (args.hidden === true || !name.startsWith(".")))
            .map(async (name) => {
              // Ссылка, ведущая из дома, и то, что не прочиталось, в список не входят.
              const info = await real(path.join(whole, name))
                .then(() => stat(path.join(whole, name)))
                .catch(() => undefined)
              if (!info || (!info.isFile() && !info.isDirectory())) return []
              return [
                {
                  name,
                  type: info.isDirectory() ? ("directory" as const) : ("file" as const),
                  size: info.isDirectory() ? 0 : info.size,
                  modified: Math.round(info.mtimeMs),
                },
              ]
            }),
        )
      ).flat()
      return {
        entries: entries.toSorted((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
        ),
      }
    },
    "storage.read": async (args) => {
      const whole = await place(args)
      return readPart(whole, shown(whole), args, extra.part, extra.isText)
    },
    "storage.thumb": async (args) => {
      const whole = await place(args)
      return thumbnail(whole, shown(whole))
    },
    // Файл приходит частями (`attachment_upload`), сюда — уже целиком.
    "storage.write": async (args) => {
      const whole = await place(args, "path", true)
      const upload = kit.takeUpload(str(args, "upload_id"))
      await mkdir(path.dirname(whole), { recursive: true })
      await writeFile(whole, upload.bytes)
      return {}
    },
    "storage.mkdir": async (args) => {
      await mkdir(await place(args, "path", true), { recursive: true })
      return {}
    },
    "storage.remove": async (args) => {
      const whole = await place(args, "path", true)
      if (!(await stat(whole).catch(() => undefined))) throw phoneRefusal("No such file")
      await rm(whole, { recursive: true, force: true })
      return {}
    },
    "storage.rename": async (args) => {
      const from = await place(args, "path", true)
      const to = await place(args, "to", true)
      if (!(await stat(from).catch(() => undefined))) throw phoneRefusal("No such file")
      if (await stat(to).catch(() => undefined)) throw phoneRefusal("A file with this name is already there")
      await mkdir(path.dirname(to), { recursive: true })
      await rename(from, to)
      return {}
    },
    // Результаты: файлы, отданные агентом, свежие первыми. `project` не назван — все; null — из
    // чатов вне проектов; id — из чатов этого проекта.
    "artifacts.list": async (args) => {
      cloudOnly()
      const at = await kit.home()
      const projects = (await kit.projects().catch(() => [])).filter((p) => p.id !== at.project)
      const wanted =
        args.project === null
          ? { directories: [at.directory], except: projects.map((p) => p.canonical) }
          : typeof args.project === "string"
            ? { directories: [(await kit.project(args.project)).canonical] }
            : {}
      const offset = typeof args.cursor === "string" ? Number(args.cursor) || 0 : 0
      const page = await rpc<{ items: BuffArtifacts.Item[]; next?: number }>(kit, at.directory, "buff.artifacts", "list", {
        ...(typeof args.session === "string" && args.session ? { sessionID: args.session } : {}),
        ...wanted,
        limit: Number(args.limit ?? 50) || 50,
        offset,
      })
      const items = await Promise.all(
        (page?.items ?? []).map(async (item) => {
          const whole = path.resolve(item.directory ?? at.directory, item.file)
          return {
            id: item.id,
            session: item.sessionID,
            sessionTitle: item.title ?? "",
            project: projectOfDirectory(item.directory, at, projects),
            path: whole,
            name: item.name,
            mime: item.mime,
            bytes: item.bytes,
            ...(item.note ? { note: item.note } : {}),
            time: item.time,
            exists: Boolean(insideHome(home, whole)) && Boolean(await stat(whole).catch(() => undefined)),
          }
        }),
      )
      // Нарисованную картинку агент нередко отдаёт ещё раз (`send_file`): один файл в одном чате —
      // один результат, по самой свежей записи.
      const seen = new Set<string>()
      const once = items.filter((item) => {
        const key = `${item.session}\u0000${item.path}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return { items: once, ...(page?.next !== undefined ? { cursor: String(page.next) } : {}) }
    },
  }
}
