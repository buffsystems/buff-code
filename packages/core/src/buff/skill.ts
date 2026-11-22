export * as BuffSkillPlugin from "./skill.js"

import path from "node:path"
import { BuffProjectDir } from "./project-dir.js"
import { Duration, Effect } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Config } from "../config.js"
import { Skill } from "../skill.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffDisabled } from "./disabled.js"
import { BuffLocale } from "./locale.js"
import { BuffSkillConfig } from "./skill-config.js"

/**
 * Управление навыками из интерфейса (#445). Свой навык — файл SKILL.md в каталоге навыков
 * пользователя (все проекты) или проекта; ядро подхватывает его само, когда файл появился или
 * изменился. Выключить можно любой навык, и свой, и чужой: файл остаётся на месте, а навык
 * уходит из реестра — его не видят ни модель, ни подсказки поля ввода. Список выключенных
 * хранится у пользователя, а не в проекте: это его выбор, а не настройка репозитория.
 *
 * Плагин стоит последним: убрать из реестра можно только то, что другие уже добавили.
 */

const DISABLED_KEY = "disabled-skills"
const { refuse } = BuffConfigFiles
type Refusal = BuffConfigFiles.Refusal

export interface Options {
  /** Сколько ждать, пока изменённые файлы перечитают. */
  readonly settle: Duration.Input
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
  /** Личная папка проекта (#951); вне проекта её нет. */
  readonly localDirectory?: string | undefined
}

/** Свой навык на диске. */
type Own = { readonly id: string; readonly scope: BuffSkill.Scope; readonly file: string; readonly text: string }

export const register = Effect.fn("BuffSkill.register")(function* (ctx: Context, options: Options) {
  const skills = yield* Skill.Service
  const fs = yield* FSUtil.Service
  const files = BuffConfigFiles.make<BuffSkill.Scope>({
    config: yield* Config.Service,
    fs,
    dirs: { user: options.userDirectory, project: ctx.location.project.directory, local: options.localDirectory },
  })
  /**
   * Каталог, в котором ядро ищет навыки области: рядом с конфигурацией пользователя, в каталоге
   * Buff Code проекта и в личной папке проекта (вне проекта её нет).
   */
  const roots: Record<BuffSkill.Scope, string | undefined> = {
    user: options.userDirectory,
    project: BuffProjectDir.of(ctx.location.project.directory),
    local: options.localDirectory,
  }
  const scopes = (["user", "project", "local"] as const).flatMap((scope) => {
    const root = roots[scope]
    return root === undefined ? [] : [{ scope, root }]
  })

  // --- выключенные ---------------------------------------------------------------------------

  // Список выключенного общий для всех открытых каталогов: сменился — каждый перечитывает реестр.
  let changed: Effect.Effect<void> = Effect.void
  const disabled = yield* BuffDisabled.make(
    ctx.storage,
    DISABLED_KEY,
    Effect.suspend(() => skills.reload().pipe(Effect.andThen(changed))),
  )
  /** Выключенные навыки, какими они были в реестре: их показывает список. */
  let hidden: Skill.Info[] = []
  yield* skills.transform((editor) => {
    hidden = [...disabled.ids()].flatMap((id) => {
      const skill = editor.get(Skill.ID.make(id))
      if (!skill) return []
      editor.remove(Skill.ID.make(id))
      return [skill]
    })
  })

  // --- свои навыки на диске ------------------------------------------------------------------

  /** Идентификатор навыка по его файлу — так же, как его выводит ядро. */
  const idOf = (directory: string, file: string) =>
    path.dirname(file) === directory && path.basename(file) !== "SKILL.md"
      ? path.basename(file, ".md")
      : path.basename(path.dirname(file))

  /** Все свои навыки на диске; один идентификатор может лежать в нескольких областях сразу. */
  const everywhere = Effect.gen(function* () {
    const found: Own[] = []
    for (const { scope, root } of scopes)
      for (const directory of [path.join(root, "skill"), path.join(root, "skills")]) {
        if (!(yield* fs.isDir(directory))) continue
        const matches = yield* fs
          .scan("{*.md,**/SKILL.md}", { cwd: directory, absolute: true })
          .pipe(Effect.orElseSucceed(() => [] as string[]))
        for (const file of matches.toSorted()) {
          const text = yield* files.text(file)
          if (text) found.push({ id: idOf(directory, file), scope, file, text })
        }
      }
    return found
  })
  /** Свой навык именно этой области: копия в другой области — другой навык. */
  const own = (scope: BuffSkill.Scope, id: string) =>
    everywhere.pipe(Effect.map((found) => found.findLast((skill) => skill.scope === scope && skill.id === id)))

  const originOf = (file: string): BuffSkill.Origin => {
    if (file.startsWith("/builtin/")) return "builtin"
    // Личная папка лежит внутри конфигурации пользователя — её проверяем первой.
    return scopes.toReversed().find((item) => files.inside(item.root, file))?.scope ?? "external"
  }

  const list = Effect.gen(function* () {
    const mine = yield* everywhere
    const entries = new Map<string, BuffSkill.Entry>()
    // Свои навыки — с диска: файл уже записан, а ядро могло его ещё не перечитать.
    for (const skill of mine) {
      const parts = BuffSkill.fileParts(skill.text)
      entries.set(skill.id, {
        id: skill.id,
        name: parts.name ?? skill.id,
        ...(parts.description ? { description: parts.description } : {}),
        scope: skill.scope,
        path: skill.file,
        enabled: !disabled.has(skill.id),
      })
    }
    for (const skill of [...(yield* skills.list()), ...hidden]) {
      const id = String(skill.id)
      if (entries.has(id)) continue
      const scope = originOf(String(skill.path))
      entries.set(id, {
        id,
        name: String(skill.name),
        ...(skill.description ? { description: skill.description } : {}),
        scope,
        ...(scope === "builtin" ? {} : { path: String(skill.path) }),
        enabled: !disabled.has(id),
      })
    }
    const sources = (yield* files.documents).flatMap((document) =>
      (document.info.skills ?? []).map((source) => ({ scope: files.scopeOf(document.file), source })),
    )
    return { skills: [...entries.values()].toSorted((a, b) => a.id.localeCompare(b.id)), sources }
  })

  // --- запись --------------------------------------------------------------------------------

  /** Убрать свой навык с диска: каталог навыка целиком либо одиночный файл. */
  const erase = Effect.fnUntraced(function* (scope: BuffSkill.Scope, id: string) {
    const skill = yield* own(scope, id)
    if (!skill) return
    const target = path.basename(skill.file) === "SKILL.md" ? path.dirname(skill.file) : skill.file
    yield* fs.remove(target, { recursive: true, force: true }).pipe(
      Effect.mapError(
        (cause): Refusal => ({
          kind: "unwritable",
          message: BuffLocale.t("Could not delete {file}: {cause}", { file: target, cause: cause.message }),
        }),
      ),
    )
  })

  const settled = Effect.sleep(options.settle)
  const done = Effect.gen(function* () {
    yield* settled
    yield* skills.reload()
    yield* changed
    return undefined
  })
  const refused =
    <A>(call: { error: (kind: Refusal["kind"], message: string, data: {}) => unknown }) =>
    (effect: Effect.Effect<A, Refusal>) =>
      effect.pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}) as never))

  const registration = yield* ctx.rpc
    .register(BuffSkill.Rpc, {
      list: () => list,
      read: (input, call) =>
        Effect.gen(function* () {
          const skill = yield* own(input.scope, input.id)
          if (!skill)
            return yield* refuse(
              "invalid",
              BuffLocale.t("The skill «{id}» is not among yours: only your own skills can be edited.", {
                id: input.id,
              }),
            )
          const parts = BuffSkill.fileParts(skill.text)
          return { name: parts.name ?? skill.id, description: parts.description ?? "", body: parts.body }
        }).pipe(refused(call)),
      save: (input, call) =>
        Effect.gen(function* () {
          const problem = BuffSkill.problem(input, BuffLocale.t)
          if (problem) return yield* refuse("invalid", problem)
          const root = roots[input.scope]
          if (root === undefined)
            return yield* refuse("invalid", BuffLocale.t("There is no project here: save it for all projects."))
          const kept = yield* own(input.scope, input.id)
          const written = {
            name: input.name.trim() || input.id,
            description: input.description.trim(),
            body: input.body,
          }
          yield* files.write(
            kept?.file ?? path.join(root, "skills", input.id, "SKILL.md"),
            kept ? BuffSkill.fileEdited(kept.text, written) : BuffSkill.fileText(written),
          )
          const previous = input.previous
          if (previous && (previous.scope !== input.scope || previous.id !== input.id))
            yield* erase(previous.scope, previous.id)
          return yield* done
        }).pipe(refused(call)),
      remove: (input, call) => erase(input.scope, input.id).pipe(Effect.andThen(done), refused(call)),
      enable: (input) =>
        Effect.gen(function* () {
          yield* disabled.set(input.id, input.enabled)
          return undefined
        }),
      attach: (input, call) =>
        Effect.gen(function* () {
          const problem = BuffSkill.sourceProblem(input.source, BuffLocale.t)
          if (problem) return yield* refuse("invalid", problem)
          const source = input.source.trim()
          yield* files.rewrite(yield* files.fileFor(input.scope), (before) =>
            BuffSkillConfig.withSource(before, source, input.attached),
          )
          return yield* done
        }).pipe(refused(call)),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<Config.Service | Skill.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "buff.skill",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    yield* register(ctx, {
      settle: "400 millis",
      userDirectory: global.config,
      localDirectory: yield* BuffProjectDir.personalFor(ctx.location.project),
    })
  }),
})
