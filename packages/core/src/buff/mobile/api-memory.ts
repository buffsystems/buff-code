// Buff (#969): инструкции и память для веб-клиента. Инструкции — файлы AGENTS.md: личные (аккаунт)
// и проекта; клиенту доступны только эти два места. Память — заметки в MEMORY.md рядом: их
// сохраняет агент (`memory_save`), а человек видит списком, дописывает, правит, удаляет и
// выключает — целиком, по области, или память аккаунта в одном проекте.
import type { BuffMemory } from "@opencode/schema/buff-memory"
import { BuffMemoryNotes } from "@opencode/schema/buff-memory-notes"
import { rpc, str, type Kit, type Ops } from "./api-kit.js"
import { phoneRefusal } from "./refusal.js"

type Scope = "account" | "project"
interface Listed {
  enabled: boolean
  files: BuffMemory.File[]
  notes?: { account: { path: string; enabled: boolean }; project?: { path: string; enabled: boolean } }
}

/** Команды памяти и то, что о памяти проекта говорит его страница (`project.get`). */
export function memoryOps(kit: Kit): { ops: Ops; projectHome: (directory: string) => Promise<Record<string, unknown>> } {
  const scopeOf = (args: Record<string, unknown>): Scope => {
    if (args.scope === "account" || args.scope === "project") return args.scope
    throw phoneRefusal("The scope is account or project")
  }
  // Где лежит область: аккаунт — в доме машины, проект — в своей папке.
  const directoryOf = async (scope: Scope, args: Record<string, unknown>) =>
    scope === "account" ? (await kit.home()).directory : (await kit.project(str(args, "project"))).canonical
  const list = (directory: string) => rpc<Listed>(kit, directory, "buff.memory", "list")
  const read = async (directory: string, path: string) =>
    (await rpc<{ text: string }>(kit, directory, "buff.memory", "read", { path }))?.text ?? ""
  const write = (directory: string, path: string, text: string) => rpc(kit, directory, "buff.memory", "write", { path, text })

  // Файл инструкций области: личный — у пользователя, проекта — в его корне.
  const instructionsOf = async (scope: Scope, args: Record<string, unknown>) => {
    const directory = await directoryOf(scope, args)
    const wanted = scope === "account" ? "user" : "project"
    const file = (await list(directory)).files.find((item) => item.scope === wanted && !item.notes)
    if (!file) throw phoneRefusal("Instructions are unavailable here")
    return { directory, file }
  }
  const shownInstructions = async (directory: string, file: BuffMemory.File) => ({
    text: file.exists ? await read(directory, file.path) : "",
    ...(file.exists && file.modified !== undefined ? { modified: file.modified } : {}),
  })
  // Файл заметок области — и когда его ещё нет.
  const notesOf = async (scope: Scope, args: Record<string, unknown>) => {
    const directory = await directoryOf(scope, args)
    const file = (await list(directory)).notes?.[scope]
    if (!file) throw phoneRefusal("Memory notes are unavailable here")
    const text = await read(directory, file.path)
    return { directory, file, text, notes: BuffMemoryNotes.parse(text) }
  }
  const shownNotes = (notes: readonly BuffMemoryNotes.Note[], enabled: boolean) => ({
    enabled,
    notes: [...notes],
    // Заметок больше, чем попадает в чат: клиент говорит об этом над списком.
    ...(BuffMemoryNotes.over(notes, kit.machine.limits.memoryMaxChars) ? { over: true } : {}),
  })
  const change = async (
    args: Record<string, unknown>,
    apply: (notes: BuffMemoryNotes.Note[]) => BuffMemoryNotes.Note[] | undefined,
  ) => {
    const at = await notesOf(scopeOf(args), args)
    const next = apply(at.notes)
    if (!next) throw phoneRefusal("No such note")
    await write(at.directory, at.file.path, BuffMemoryNotes.serialize(at.text, next))
    return { notes: next }
  }
  /** Состояние памяти проекта для его страницы. */
  const projectMemory = async (directory: string) => {
    const listed = await list(directory)
    const file = listed.notes?.project
    const notes = file ? BuffMemoryNotes.parse(await read(directory, file.path)) : []
    const account = await rpc<{ on: boolean }>(kit, directory, "buff.memory", "useAccount", {})
    return { listed, notes, enabled: file?.enabled ?? true, useAccount: account?.on ?? true }
  }
  // Страница проекта: к проекту и числу чатов — его инструкции и состояние памяти.
  const projectHome = async (directory: string) => {
    const memory = await projectMemory(directory)
    const file = memory.listed.files.find((item) => item.scope === "project" && !item.notes)
    return {
      instructions: file ? await shownInstructions(directory, file) : { text: "" },
      memory: {
        enabled: memory.listed.enabled && memory.enabled,
        useAccount: memory.useAccount,
        notes: memory.notes.length,
      },
    }
  }
  const ops: Ops = {
    "instructions.get": async (args) => {
      const at = await instructionsOf(scopeOf(args), args)
      return shownInstructions(at.directory, at.file)
    },
    "instructions.set": async (args) => {
      const scope = scopeOf(args)
      const at = await instructionsOf(scope, args)
      await write(at.directory, at.file.path, typeof args.text === "string" ? args.text : "")
      const fresh = await instructionsOf(scope, args)
      return shownInstructions(fresh.directory, fresh.file)
    },
    // Выключатель: без области — вся память (и инструкции, и заметки); с областью — её заметки.
    "memory.enable": async (args) => {
      const enabled = args.enabled === true
      if (args.scope === undefined) {
        await rpc(kit, (await kit.home()).directory, "buff.memory", "enable", { enabled })
        return {}
      }
      const at = await notesOf(scopeOf(args), args)
      await rpc(kit, at.directory, "buff.memory", "enable", { path: at.file.path, enabled })
      return {}
    },
    "memory.list": async (args) => {
      const account = await notesOf("account", args)
      const listed = await list(account.directory)
      const project =
        typeof args.project === "string" && args.project
          ? await projectMemory((await kit.project(args.project)).canonical)
          : undefined
      return {
        enabled: listed.enabled,
        account: shownNotes(account.notes, account.file.enabled),
        ...(project
          ? { project: { ...shownNotes(project.notes, project.enabled), useAccount: project.useAccount } }
          : {}),
      }
    },
    "memory.note.add": async (args) => {
      const text = str(args, "text")
      return change(args, (notes) =>
        BuffMemoryNotes.add(notes, text, {
          id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          at: new Date().toISOString(),
        }),
      )
    },
    "memory.note.edit": async (args) => {
      const [id, text] = [str(args, "id"), str(args, "text")]
      return change(args, (notes) => BuffMemoryNotes.edit(notes, id, text))
    },
    "memory.note.remove": async (args) => {
      const id = str(args, "id")
      return change(args, (notes) => BuffMemoryNotes.remove(notes, id))
    },
    "memory.useAccount": async (args) => {
      const directory = (await kit.project(str(args, "project"))).canonical
      await rpc(kit, directory, "buff.memory", "useAccount", { on: args.on === true })
      return {}
    },
  }
  return { ops, projectHome }
}
