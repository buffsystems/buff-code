export * as BuffChatPluginStore from "./chat-plugin.js"

import path from "node:path"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { Scope } from "effect"
import { SystemPart } from "@opencode/ai"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Permission } from "../permission.js"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { BuffChatPluginBuiltin } from "./chat-plugin/builtin/index.js"
import { BuffChatPluginTests } from "./chat-plugin-tests.js"
import { BuffChatPluginTools } from "./chat-plugin-tools.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffDisabled } from "./disabled.js"
import { BuffLocale } from "./locale.js"
import { BuffProjectDir } from "./project-dir.js"
import contextTemplate from "./chat-plugin/prompts/context.md" with { type: "text" }
import skillDescription from "./chat-plugin/prompts/skill-description.md" with { type: "text" }
import skillReferences from "./chat-plugin/prompts/skill-references.md" with { type: "text" }
import systemTemplate from "./chat-plugin/prompts/system.md" with { type: "text" }

/**
 * Плагины чатов (#595, #979). Плагин — папка `chat-plugins/<id>` в каталоге конфигурации
 * пользователя (все проекты) или в личной папке проекта; встроенные лежат в том же виде внутри
 * Buff Code. Ядро читает папки с диска при каждом запросе — их единицы, а только что записанный
 * плагин виден сразу, — и отдаёт клиентам список и страницу отрисовщика. Выключенный плагин
 * остаётся на диске: список выключенных хранится у пользователя, как у навыков.
 *
 * Для модели плагин — навык с визуализацией и подгружается так же, в три шага: в промпте всегда
 * только имя и описание с именами блоков (навык `visual-<id>` в реестре навыков); инструкцию
 * `GUIDE.md` модель загружает инструментом `skill`, когда плагин понадобился; справочники
 * `guide/*.md` читает по ссылкам из неё. Сотня плагинов стоит контексту сотню строк.
 */

/** Встроенные плагины выкладываются сюда: справочники модель читает с диска. */
const BUILTIN_DIR = ".builtin"

const DISABLED_KEY = "disabled-chat-plugins"
const { refuse } = BuffConfigFiles
type Refusal = BuffConfigFiles.Refusal

/** Встроенный плагин: те же файлы, что в папке, по именам относительно неё. */
export interface Builtin {
  readonly id: string
  readonly files: Readonly<Record<string, string>>
}

export interface Options {
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
  /** Личная папка проекта (#951); вне проекта её нет. */
  readonly localDirectory?: string | undefined
  readonly builtins: readonly Builtin[]
  /** Срок ожидания живой проверки (мс); тесты ставят короткий. */
  readonly testWait?: number
}

/** Прочитанный плагин: строка списка без признака «включён», файлы и папка на диске. */
interface Loaded {
  readonly entry: Omit<BuffChatPlugin.Entry, "enabled">
  readonly files: Readonly<Record<string, string>>
  readonly directory?: string
}

const TOP_FILES = [
  BuffChatPlugin.FILES.manifest,
  BuffChatPlugin.FILES.view,
  BuffChatPlugin.FILES.guide,
  BuffChatPlugin.FILES.text,
]
const EXAMPLE = new RegExp(`^${BuffChatPlugin.FILES.examples}/([^/]+)\\.md$`)

/** Плагин из его файлов: описание, отпечаток и причина, если работать он не может. */
export function load(
  id: string,
  origin: BuffChatPlugin.Origin,
  files: Readonly<Record<string, string>>,
  t = BuffLocale.t,
): Loaded["entry"] {
  const read = BuffChatPlugin.manifestOf(files[BuffChatPlugin.FILES.manifest] ?? "", t)
  const view = files[BuffChatPlugin.FILES.view]
  const guide = files[BuffChatPlugin.FILES.guide]
  const problem =
    "problem" in read
      ? read.problem
      : !view?.trim()
        ? t("The plugin has no view: the file {file} is missing or empty.", { file: BuffChatPlugin.FILES.view })
        : Buffer.byteLength(view) > BuffChatPlugin.LIMITS.viewBytes
          ? t("The view is too large: {file} must fit into {size} MB.", {
              file: BuffChatPlugin.FILES.view,
              size: BuffChatPlugin.LIMITS.viewBytes / 1024 / 1024,
            })
          : !guide?.trim()
            ? t("The plugin has no guide for the model: the file {file} is missing or empty.", {
                file: BuffChatPlugin.FILES.guide,
              })
            : guide.length > BuffChatPlugin.LIMITS.guideChars
              ? t("The guide is too long: {file} must fit into {size} characters.", {
                  file: BuffChatPlugin.FILES.guide,
                  size: BuffChatPlugin.LIMITS.guideChars,
                })
              : undefined
  const names = Object.keys(files).toSorted()
  const hash = createHash("sha256")
  for (const name of names) hash.update(name).update("\0").update(files[name]!).update("\0")
  const manifest = "manifest" in read ? read.manifest : { name: id, description: "", blocks: [] }
  return {
    id,
    ...manifest,
    origin,
    version: hash.digest("hex").slice(0, 16),
    text: Boolean(files[BuffChatPlugin.FILES.text]?.trim()),
    examples: names.flatMap((name) => EXAMPLE.exec(name)?.[1] ?? []),
    ...(problem ? { problem } : {}),
  }
}

export const register = Effect.fn("BuffChatPlugin.register")(function* (ctx: Context, options: Options) {
  const fs = yield* FSUtil.Service
  const skills = yield* Skill.Service
  const roots = [
    ...(options.localDirectory ? [{ origin: "local" as const, root: options.localDirectory }] : []),
    { origin: "user" as const, root: options.userDirectory },
  ]

  let changed: Effect.Effect<void> = Effect.void
  const disabled = yield* BuffDisabled.make(
    ctx.storage,
    DISABLED_KEY,
    Effect.suspend(() => changed),
  )

  // Встроенные плагины — на диск, раз на версию: инструкцию и справочники модель читает файлами.
  const builtins: Loaded[] = []
  for (const builtin of options.builtins) {
    const entry = load(builtin.id, "builtin", builtin.files)
    const directory = path.join(options.userDirectory, BuffChatPlugin.DIR, BUILTIN_DIR, builtin.id)
    const stamp = path.join(directory, ".version")
    const laid = yield* fs.readFileStringSafe(stamp).pipe(Effect.orElseSucceed(() => undefined))
    if (laid !== entry.version) {
      yield* fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore)
      for (const [name, text] of Object.entries(builtin.files))
        yield* fs.writeWithDirs(path.join(directory, name), text).pipe(Effect.ignore)
      yield* fs.writeWithDirs(stamp, entry.version).pipe(Effect.ignore)
    }
    builtins.push({ entry, files: builtin.files, directory })
  }

  /** Файлы папки плагина по именам относительно неё; чужое в папке не читаем. */
  const folder = Effect.fnUntraced(function* (directory: string) {
    const names = yield* fs
      .scan(`{${TOP_FILES.join(",")},{${BuffChatPlugin.FILES.examples},${BuffChatPlugin.FILES.references}}/*.md}`, {
        cwd: directory,
        include: "file",
      })
      .pipe(Effect.orElseSucceed(() => [] as string[]))
    const files: Record<string, string> = {}
    for (const name of names) {
      const text = yield* fs.readFileStringSafe(path.join(directory, name)).pipe(Effect.orElseSucceed(() => undefined))
      if (text !== undefined) files[name.split(path.sep).join("/")] = text
    }
    return files
  })

  /** Все плагины: встроенные, затем личной папки проекта, затем пользователя; первый по id главный. */
  const all = Effect.gen(function* () {
    const found = new Map<string, Loaded>()
    for (const builtin of builtins) found.set(builtin.entry.id, builtin)
    for (const { origin, root } of roots) {
      const home = path.join(root, BuffChatPlugin.DIR)
      const entries = yield* fs.readDirectoryEntries(home).pipe(Effect.orElseSucceed(() => []))
      for (const item of entries) {
        if (item.type !== "directory" || found.has(item.name) || BuffChatPlugin.idProblem(item.name)) continue
        const directory = path.join(home, item.name)
        const files = yield* folder(directory)
        found.set(item.name, { entry: load(item.name, origin, files), files, directory })
      }
    }
    return [...found.values()].toSorted((a, b) => a.entry.id.localeCompare(b.entry.id))
  })

  const entryOf = (loaded: Loaded): BuffChatPlugin.Entry => ({
    ...loaded.entry,
    enabled: !disabled.has(loaded.entry.id),
  })
  const unknown = (id: string) => refuse("invalid", BuffLocale.t("There is no chat plugin «{id}».", { id }))
  const find = Effect.fnUntraced(function* (id: string) {
    const loaded = (yield* all).find((item) => item.entry.id === id)
    return loaded ?? (yield* unknown(id))
  })

  // --- плагины как навыки -------------------------------------------------------------------

  /** Навыки включённых плагинов, какими их видит реестр навыков сейчас. */
  let offered: Skill.Info[] = []
  const skillsOf = (plugins: readonly Loaded[]) => {
    const entries = plugins.map(entryOf)
    const owned = BuffChatPlugin.owners(entries)
    return plugins.flatMap((loaded, index) => {
      if (!loaded.directory) return []
      const skill = BuffChatPlugin.skillOf({
        entry: entries[index]!,
        guide: loaded.files[BuffChatPlugin.FILES.guide] ?? "",
        directory: loaded.directory,
        files: loaded.files,
        owned,
        templates: { description: skillDescription, references: skillReferences },
      })
      if (!skill) return []
      return [
        Skill.Info.make({
          id: Skill.ID.make(skill.id),
          name: Skill.Name.make(skill.name),
          description: skill.description,
          // Не SKILL.md: перечень файлов папки ядро не добавляет — нужные названы в самой инструкции.
          path: AbsolutePath.make(path.join(loaded.directory, BuffChatPlugin.FILES.guide)),
          content: skill.content,
        }),
      ]
    })
  }
  const stamp = (list: readonly Skill.Info[]) =>
    list.map((skill) => `${skill.id}\0${skill.description}\0${skill.content}`).join("\u0001")
  /** Привести навыки к тому, что лежит на диске: реестр перечитывается, только когда что-то сменилось. */
  const sync = all.pipe(
    Effect.flatMap((plugins) => {
      const next = skillsOf(plugins)
      if (stamp(next) === stamp(offered)) return Effect.succeed(plugins)
      offered = next
      return skills.reload().pipe(Effect.as(plugins))
    }),
  )
  yield* skills.transform((editor) => {
    for (const skill of offered) editor.add(skill)
  })
  yield* sync

  /** Часть системного промпта: общие правила визуализаций; без включённых плагинов её нет. */
  const system = sync.pipe(Effect.map((): string | undefined => (offered.length ? systemTemplate.trim() : undefined)))

  /**
   * Что человек выставил в визуализациях чата: по чату, по рамке — последнее сказанное ею.
   * Живёт в памяти процесса: это состояние экрана, а не переписки.
   */
  const states = new Map<string, Map<string, { readonly plugin: string; readonly text: string }>>()
  const context = (session: string) =>
    BuffChatPlugin.contextText(contextTemplate, [...(states.get(session)?.values() ?? [])])

  const desk = BuffChatPluginTests.make()

  const refused =
    <A>(call: { error: (kind: Refusal["kind"], message: string, data: {}) => unknown }) =>
    (effect: Effect.Effect<A, Refusal>) =>
      effect.pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}) as never))

  const registration = yield* ctx.rpc
    .register(BuffChatPlugin.Rpc, {
      list: () => sync.pipe(Effect.map((plugins) => ({ plugins: plugins.map(entryOf) }))),
      view: (input, call) =>
        Effect.gen(function* () {
          const loaded = yield* find(input.id)
          if (loaded.entry.problem) return yield* refuse("invalid", loaded.entry.problem)
          return { html: loaded.files[BuffChatPlugin.FILES.view]!, version: loaded.entry.version }
        }).pipe(refused(call)),
      example: (input, call) =>
        Effect.gen(function* () {
          const loaded = yield* find(input.id)
          const file = loaded.files[`${BuffChatPlugin.FILES.examples}/${input.name}.md`]
          const example = file === undefined ? undefined : BuffChatPlugin.exampleOf(file)
          return (
            example ??
            (yield* refuse(
              "invalid",
              BuffLocale.t("The plugin «{id}» has no example «{name}».", { id: input.id, name: input.name }),
            ))
          )
        }).pipe(refused(call)),
      enable: (input) =>
        Effect.gen(function* () {
          yield* disabled.set(input.id, input.enabled)
          return undefined
        }),
      remove: (input, call) =>
        Effect.gen(function* () {
          const loaded = yield* find(input.id)
          const directory = loaded.entry.origin === "builtin" ? undefined : loaded.directory
          if (!directory)
            return yield* refuse(
              "invalid",
              BuffLocale.t("«{id}» is built in: it can be switched off, not removed.", { id: input.id }),
            )
          yield* fs.remove(directory, { recursive: true, force: true }).pipe(
            Effect.mapError(
              (cause): Refusal => ({
                kind: "unwritable",
                message: BuffLocale.t("Could not delete {file}: {cause}", {
                  file: directory,
                  cause: cause.message,
                }),
              }),
            ),
          )
          yield* changed
          return undefined
        }).pipe(refused(call)),
      context: (input, call) =>
        Effect.gen(function* () {
          const text = input.text?.trim() ?? ""
          const frames = states.get(input.session) ?? new Map<string, { plugin: string; text: string }>()
          if (!text) {
            frames.delete(input.frame)
            if (!frames.size) states.delete(input.session)
            return undefined
          }
          if (text.length > BuffChatPlugin.LIMITS.contextChars)
            return yield* refuse(
              "invalid",
              BuffLocale.t("A visual may tell the model at most {size} characters.", {
                size: BuffChatPlugin.LIMITS.contextChars,
              }),
            )
          const loaded = yield* find(input.id)
          // Сказанное заново встаёт в конец: вытесняется то, чего человек давно не трогал.
          frames.delete(input.frame)
          frames.set(input.frame, { plugin: loaded.entry.name, text })
          for (const frame of [...frames.keys()].slice(0, -BuffChatPlugin.LIMITS.contextFrames)) frames.delete(frame)
          states.set(input.session, frames)
          return undefined
        }).pipe(refused(call)),
      script: (input, call) =>
        Effect.gen(function* () {
          const loaded = yield* find(input.id)
          const js = loaded.files[BuffChatPlugin.FILES.text]
          if (!js?.trim())
            return yield* refuse(
              "invalid",
              BuffLocale.t("The plugin «{id}» has no text form for the console.", { id: input.id }),
            )
          return { js, version: loaded.entry.version }
        }).pipe(refused(call)),
      tests: (input) => Effect.sync(() => ({ tests: desk.pending(input.session) })),
      report: (input) =>
        Effect.sync(() => {
          desk.report(
            `${input.session}:${input.call}`,
            input.example,
            input.ok
              ? { ok: true, ...(input.height === undefined ? {} : { height: input.height }) }
              : { ok: false, error: input.error?.trim() || "The view failed without a message." },
          )
          return undefined
        }),
    })
    .pipe(Effect.orDie)
  // Сменилось что угодно — навыки приводятся к диску, потом об этом узнают клиенты.
  changed = sync.pipe(Effect.andThen(registration.events.emit("changed", {})), Effect.ignore)

  yield* ctx.session.hook("context", (event) =>
    system.pipe(
      Effect.map((text) => {
        if (text) event.system.push(SystemPart.make(text))
        const told = context(event.sessionID)
        if (told) event.system.push(SystemPart.make(told))
      }),
    ),
  )

  const tools = yield* BuffChatPluginTools.register(ctx, {
    fs,
    all: sync.pipe(
      Effect.map((plugins) =>
        plugins.map((loaded) => ({ entry: entryOf(loaded), files: loaded.files, directory: loaded.directory })),
      ),
    ),
    roots: { user: options.userDirectory, local: options.localDirectory },
    project: path.basename(ctx.location.project.directory),
    enable: (id) => disabled.set(id, true),
    changed: Effect.suspend(() => changed),
    desk,
    ...(options.testWait === undefined ? {} : { testWait: options.testWait }),
  })

  return {
    tools,
    system,
    context,
    all: all.pipe(Effect.map((plugins) => plugins.map(entryOf))),
    changed: Effect.suspend(() => changed),
  }
})

export const Plugin = define<FSUtil.Service | Global.Service | Permission.Service | Skill.Service | Scope.Scope>({
  id: "buff.chat-plugin",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    yield* register(ctx, {
      userDirectory: global.config,
      localDirectory: yield* BuffProjectDir.personalFor(ctx.location.project),
      builtins: BuffChatPluginBuiltin.all,
    })
  }),
})
