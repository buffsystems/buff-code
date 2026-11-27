export * as BuffMemoryPlugin from "./memory.js"

import { Duration, Effect, Option } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffMemory } from "@opencode/schema/buff-memory"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffDisabled } from "./disabled.js"
import { BuffLocale } from "./locale.js"
import { BuffMemoryFiles } from "./memory-files.js"
import { BuffMemoryNotes } from "@opencode/schema/buff-memory-notes"
import { ToolFailure } from "@opencode/ai"
import { AbsolutePath } from "../schema.js"
import { BuffMemoryTool } from "./memory-tool.js"
import { machineOf } from "./mobile/api-machine.js"

/**
 * Память из интерфейса (#446): файлы AGENTS.md — общий у пользователя и файлы проекта.
 * Список, чтение и запись, выключатель у файла и общий. Выключенный файл остаётся на диске,
 * но модель его не получает; общий выключатель действует и на файлы вложенных каталогов,
 * которые ядро подгружает по ходу работы. Что выключено, хранится у пользователя.
 *
 * Плагин стоит после загрузчика файлов памяти: исключить можно только уже найденное.
 *
 * Заметки памяти (#969) — второй файл, MEMORY.md: у пользователя (аккаунт) и в корне проекта.
 * Их сохраняет агент (`memory_save`) и правит человек; модель получает их пунктами в начале чата,
 * не больше предела машины. Заметки аккаунта проект может у себя выключить.
 */

/** Вся память разом — в том же списке выключенного, что и отдельные файлы. */
const ALL = "*"
const { refuse } = BuffConfigFiles
type Refusal = BuffConfigFiles.Refusal

export interface Options {
  /** Сколько ждать, пока изменённые файлы перечитают. */
  readonly settle: Duration.Input
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
  /** Дом пользователя: каталог в нём самом — чат вне проекта. */
  readonly home?: string
}

/** Что модель читает над заметками. */
const NOTES_HEAD = "Memory notes — facts and preferences saved earlier (memory_save adds one):\n"

export const register = Effect.fn("BuffMemory.register")(function* (ctx: Context, options: Options) {
  const discovery = yield* InstructionDiscovery.Service
  const fs = yield* FSUtil.Service
  const places = BuffMemoryFiles.places({
    user: yield* fs.resolve(options.userDirectory),
    root: yield* fs.resolve(ctx.location.project.directory),
    directory: yield* fs.resolve(ctx.location.directory),
    ...(options.home ? { home: yield* fs.resolve(options.home) } : {}),
  })
  const noteFiles = BuffMemoryFiles.notes(places)
  const maxChars = machineOf(process.env, options.home ?? "").limits.memoryMaxChars
  // Память аккаунта в этом проекте — в том же списке выключенного.
  const ACCOUNT_OFF = `project:${ctx.location.project.id}:account`
  // Заметки, как их получит модель: перечитываются после каждой записи.
  const noted = new Map<string, string>()
  const refreshNotes = Effect.promise(async () => {
    for (const file of [noteFiles.account, ...(noteFiles.project ? [noteFiles.project] : [])]) {
      const text = BuffMemoryNotes.forModel(BuffMemoryNotes.parse(await BuffMemoryTool.read(file)), maxChars)
      if (text) noted.set(file, text)
      else noted.delete(file)
    }
  })
  yield* refreshNotes
  const place = (path: string) => places.find((item) => item.path === path)

  // Что выключено — общее для всех открытых каталогов: сменилось — каждый перечитывает память.
  let changed: Effect.Effect<void> = Effect.void
  const disabled = yield* BuffDisabled.make(
    ctx.storage,
    "disabled-memory",
    Effect.suspend(() => discovery.reload().pipe(Effect.andThen(changed))),
  )
  const off = () => disabled.has(ALL)
  yield* discovery.transform((editor) => {
    for (const [file, text] of noted) {
      if (file === noteFiles.account && disabled.has(ACCOUNT_OFF)) continue
      editor.add({ path: AbsolutePath.make(file), content: NOTES_HEAD + text })
    }
    editor.exclude((path) => off() || disabled.has(path))
  })

  const modified = (path: string) =>
    fs.stat(path).pipe(
      Effect.map((info) => (info.type === "File" ? Option.getOrUndefined(info.mtime)?.getTime() : undefined)),
      Effect.orElseSucceed(() => undefined),
    )

  const list = Effect.gen(function* () {
    const times = new Map<string, number>()
    for (const item of places) {
      const time = yield* modified(item.path)
      if (time !== undefined) times.set(item.path, time)
    }
    const files = BuffMemoryFiles.shown(places, new Set(times.keys())).map((item): BuffMemory.File => {
      const time = times.get(item.path)
      return {
        path: item.path,
        scope: item.scope,
        ...(item.notes ? { notes: true } : {}),
        exists: time !== undefined,
        ...(time === undefined ? {} : { modified: time }),
        enabled: !disabled.has(item.path),
      }
    })
    const notesFile = (path: string) => ({ path, enabled: !disabled.has(path) })
    return {
      enabled: !off(),
      files,
      notes: {
        account: notesFile(noteFiles.account),
        ...(noteFiles.project ? { project: notesFile(noteFiles.project) } : {}),
      },
    }
  })

  const known = (path: string) =>
    place(path)
      ? Effect.void
      : refuse("invalid", BuffLocale.t("{file} is not a memory file of this directory.", { file: path }))

  const settled = Effect.sleep(options.settle)
  const done = Effect.gen(function* () {
    yield* settled
    yield* refreshNotes
    yield* discovery.reload()
    yield* changed
    return undefined
  })
  const refused =
    <A>(call: { error: (kind: Refusal["kind"], message: string, data: {}) => unknown }) =>
    (effect: Effect.Effect<A, Refusal>) =>
      effect.pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}) as never))

  const registration = yield* ctx.rpc
    .register(BuffMemory.Rpc, {
      list: () => list,
      read: (input, call) =>
        Effect.gen(function* () {
          yield* known(input.path)
          const text = yield* fs.readFileStringSafe(input.path).pipe(Effect.orElseSucceed(() => undefined))
          return { text: text ?? "" }
        }).pipe(refused(call)),
      write: (input, call) =>
        Effect.gen(function* () {
          yield* known(input.path)
          yield* fs
            .writeWithDirs(input.path, input.text.endsWith("\n") || !input.text ? input.text : `${input.text}\n`)
            .pipe(
              Effect.mapError(
                (cause): Refusal => ({
                  kind: "unwritable",
                  message: BuffLocale.t("Could not write {file}: {cause}", { file: input.path, cause: cause.message }),
                }),
              ),
            )
          return yield* done
        }).pipe(refused(call)),
      enable: (input, call) =>
        Effect.gen(function* () {
          if (input.path !== undefined) yield* known(input.path)
          yield* disabled.set(input.path ?? ALL, input.enabled)
          return undefined
        }).pipe(refused(call)),
      useAccount: (input) =>
        Effect.gen(function* () {
          if (input.on !== undefined) yield* disabled.set(ACCOUNT_OFF, input.on)
          return { on: !disabled.has(ACCOUNT_OFF) }
        }),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)

  // Заметку сохраняет агент: одна — за вызов; новые чаты получают её с начала, идущие — обновлением.
  yield* ctx.tool
    .transform((editor) =>
      editor.add({
        name: BuffMemoryTool.TOOL,
        options: { codemode: false },
        description: BuffMemoryTool.description,
        input: BuffMemoryTool.Input,
        output: BuffMemoryTool.Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            const saved = yield* Effect.tryPromise({
              try: () =>
                BuffMemoryTool.save(noteFiles, input, {
                  id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                  at: new Date().toISOString(),
                  chat: String(context.sessionID),
                }),
              catch: (cause) => new ToolFailure({ message: cause instanceof Error ? cause.message : String(cause) }),
            })
            yield* refreshNotes
            yield* discovery.reload()
            yield* changed
            return {
              output: { id: saved.id, scope: saved.scope },
              content: BuffMemoryTool.reply(saved),
              metadata: { memory: { ...saved } },
            }
          }),
      }),
    )
    .pipe(Effect.orDie)
})

export const Plugin = define<InstructionDiscovery.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "buff.memory",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    yield* register(ctx, { settle: "400 millis", userDirectory: global.config, home: global.home })
  }),
})
