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

/**
 * Память из интерфейса (#446): файлы AGENTS.md — общий у пользователя и файлы проекта.
 * Список, чтение и запись, выключатель у файла и общий. Выключенный файл остаётся на диске,
 * но модель его не получает; общий выключатель действует и на файлы вложенных каталогов,
 * которые ядро подгружает по ходу работы. Что выключено, хранится у пользователя.
 *
 * Плагин стоит после загрузчика файлов памяти: исключить можно только уже найденное.
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
}

export const register = Effect.fn("BuffMemory.register")(function* (ctx: Context, options: Options) {
  const discovery = yield* InstructionDiscovery.Service
  const fs = yield* FSUtil.Service
  const places = BuffMemoryFiles.places({
    user: yield* fs.resolve(options.userDirectory),
    root: yield* fs.resolve(ctx.location.project.directory),
    directory: yield* fs.resolve(ctx.location.directory),
  })
  const place = (path: string) => places.find((item) => item.path === path)

  // Что выключено — общее для всех открытых каталогов: сменилось — каждый перечитывает память.
  let changed: Effect.Effect<void> = Effect.void
  const disabled = yield* BuffDisabled.make(
    ctx.storage,
    "disabled-memory",
    Effect.suspend(() => discovery.reload().pipe(Effect.andThen(changed))),
  )
  const off = () => disabled.has(ALL)
  yield* discovery.transform((editor) => editor.exclude((path) => off() || disabled.has(path)))

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
        exists: time !== undefined,
        ...(time === undefined ? {} : { modified: time }),
        enabled: !disabled.has(item.path),
      }
    })
    return { enabled: !off(), files }
  })

  const known = (path: string) =>
    place(path)
      ? Effect.void
      : refuse("invalid", BuffLocale.t("{file} is not a memory file of this directory.", { file: path }))

  const settled = Effect.sleep(options.settle)
  const done = Effect.gen(function* () {
    yield* settled
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
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<InstructionDiscovery.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "buff.memory",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx, { settle: "400 millis", userDirectory: (yield* Global.Service).config })
  }),
})
