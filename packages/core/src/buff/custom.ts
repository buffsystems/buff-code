export * as BuffCustomPlugin from "./custom.js"

import path from "node:path"
import { BuffProjectDir } from "./project-dir.js"
import { Duration, Effect } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffCustom } from "@opencode/schema/buff-custom"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Agent } from "../agent.js"
import { Command } from "../command.js"
import type { Info as ConfigInfo } from "@opencode/schema/config"
import { Config } from "../config.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffCustomList } from "./custom-list.js"
import { BuffDisabled } from "./disabled.js"
import { BuffLocale } from "./locale.js"
import { BuffTrust } from "./trust.js"

/**
 * Команды и субагенты из интерфейса (#446). Своя запись — файл Markdown в каталоге настроек
 * пользователя (все проекты) или проекта; ядро подхватывает его само, когда файл появился или
 * изменился. Выключить можно любую запись, и свою, и чужую: файл остаётся на месте, а запись
 * уходит из реестра. Список выключенного хранится у пользователя, а не в проекте.
 *
 * Команда проекта может вставлять вывод оболочки, поэтому не выполняется, пока человек не
 * посмотрел её текст и не подтвердил; изменился текст — подтверждение спрашивается заново.
 *
 * Плагин стоит в конце: убрать из реестра можно только то, что другие уже добавили.
 */

const { refuse } = BuffConfigFiles
type Refusal = BuffConfigFiles.Refusal

export interface Options {
  /** Сколько ждать, пока изменённые файлы перечитают. */
  readonly settle: Duration.Input
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
}

/** Чем виды различаются для ядра: реестр, из которого запись убирают и в котором её видно. */
interface Registry {
  readonly registered: Effect.Effect<BuffCustomList.Registered[]>
  readonly configured: (info: ConfigInfo) => readonly string[]
  /** Можно ли выключить запись; строка — почему нельзя. */
  readonly lock: (id: string) => Effect.Effect<string | undefined>
  readonly reload: Effect.Effect<void>
}

export const register = Effect.fn("BuffCustom.register")(function* (ctx: Context, options: Options) {
  const commands = yield* Command.Service
  const agents = yield* Agent.Service
  const fs = yield* FSUtil.Service
  const files = BuffConfigFiles.make({
    config: yield* Config.Service,
    fs,
    dirs: { user: options.userDirectory, project: ctx.location.project.directory },
  })
  /** Каталог настроек области: у пользователя и каталог Buff Code в проекте. */
  const roots: Record<BuffCustom.Scope, string> = {
    user: options.userDirectory,
    project: BuffProjectDir.of(ctx.location.project.directory),
  }
  // Выключенное и подтверждённое — общие для всех открытых каталогов: сменились — каждый
  // перечитывает реестр и говорит своим экранам.
  let changed: Effect.Effect<void> = Effect.void
  const told = Effect.suspend(() => changed)
  const disabled = {
    command: yield* BuffDisabled.make(ctx.storage, "disabled-commands", commands.reload().pipe(Effect.andThen(told))),
    agent: yield* BuffDisabled.make(ctx.storage, "disabled-agents", agents.reload().pipe(Effect.andThen(told))),
  }

  // --- выключенное уходит из реестра, но остаётся в списке ------------------------------------

  const hidden: Record<BuffCustom.KindName, BuffCustomList.Registered[]> = { command: [], agent: [] }
  const trust = yield* BuffTrust.make(ctx.storage, "trusted-commands", told)
  yield* commands.transform((editor) => {
    hidden.command = [...disabled.command.ids()].flatMap((id) => {
      const command = editor.get(id)
      if (!command) return []
      editor.remove(id)
      return [{ id, description: command.description }]
    })
    // Проверка — в момент вызова: что команда пришла из проекта и подтверждена ли, видно по диску.
    for (const command of editor.list())
      editor.add({ ...command, execute: (input) => guard(command.name).pipe(Effect.andThen(command.execute(input))) })
  })
  const agentRow = (agent: Agent.Info): BuffCustomList.Registered => ({
    id: String(agent.id),
    description: agent.description,
    values: {
      mode: agent.mode,
      ...(agent.model ? { model: `${agent.model.providerID}/${agent.model.id}` } : {}),
    },
  })
  yield* agents.transform((editor) => {
    hidden.agent = [...disabled.agent.ids()].flatMap((id) => {
      const agent = editor.get(Agent.ID.make(id))
      if (!agent) return []
      editor.remove(Agent.ID.make(id))
      return [agentRow(agent)]
    })
  })

  const registries: Record<BuffCustom.KindName, Registry> = {
    command: {
      registered: commands
        .list()
        .pipe(Effect.map((list) => list.map((item) => ({ id: item.name, description: item.description })))),
      configured: (info) => Object.keys(info.commands ?? {}),
      lock: () => Effect.succeed(undefined),
      reload: commands.reload(),
    },
    agent: {
      // Служебные агенты (сжатие, заголовок) в настройках не показываются.
      registered: agents.list().pipe(Effect.map((list) => list.filter((agent) => !agent.hidden).map(agentRow))),
      configured: (info) => Object.keys(info.agents ?? {}),
      lock: (id) =>
        agents
          .list()
          .pipe(
            Effect.map((list) =>
              list.some((agent) => String(agent.id) !== id && agent.mode !== "subagent" && !agent.hidden)
                ? undefined
                : BuffLocale.t("This is the last primary agent — without it nobody can run the session."),
            ),
          ),
      reload: agents.reload(),
    },
  }

  // --- свои файлы -----------------------------------------------------------------------------

  type OwnFile = BuffCustomList.Own & { readonly text: string }

  const own = Effect.fnUntraced(function* (kind: BuffCustom.Kind) {
    const found: OwnFile[] = []
    for (const scope of ["user", "project"] as const) {
      const matches = yield* fs
        .scan(`{${kind.directories.join(",")}}/**/*.md`, { cwd: roots[scope], absolute: true, dot: true })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      for (const file of matches.toSorted()) {
        const id = BuffCustom.idOf(kind, path.relative(roots[scope], file))
        const text = yield* files.text(file)
        if (id && text !== undefined)
          found.push({ id, scope, file, text, values: BuffCustom.fileParts(kind, text).values })
      }
    }
    return found
  })
  const find = Effect.fnUntraced(function* (kind: BuffCustom.Kind, scope: BuffCustom.Scope, id: string) {
    return (yield* own(kind)).findLast((item) => item.id === id && item.scope === scope)
  })

  // --- доверие к командам проекта ---------------------------------------------------------------

  // Ключ — проект и имя, а не путь файла: в рабочих деревьях проекта команда одна и та же.
  const trustKey = (name: string) => `${ctx.location.project.canonical}#${name}`
  /** Команды, пришедшие из проекта: чем их опознать и что человек проверяет. */
  const projectCommands = Effect.gen(function* () {
    const found = new Map<string, { readonly key: string; readonly content: string }>()
    for (const document of yield* files.documents) {
      if (files.scopeOf(document.file) !== "project") continue
      for (const [name, command] of Object.entries(document.info.commands ?? {}))
        found.set(name, { key: trustKey(name), content: JSON.stringify(command, null, 2) })
    }
    for (const item of yield* own(BuffCustom.kinds.command))
      if (item.scope === "project") found.set(item.id, { key: trustKey(item.id), content: item.text })
    return found
  })
  const guard = (name: string) =>
    projectCommands.pipe(
      Effect.flatMap((found) => {
        const source = found.get(name)
        return !source || trust.ok(source.key, source.content)
          ? Effect.void
          : Effect.fail(new Error(BuffCustom.untrusted(name, BuffLocale.t)))
      }),
    )
  const reviewed = Effect.fnUntraced(function* (kind: BuffCustom.Kind, id: string) {
    const source = kind.name === "command" ? (yield* projectCommands).get(id) : undefined
    return (
      source ??
      (yield* refuse("invalid", BuffLocale.t("«{id}» is not from the project: there is nothing to confirm.", { id })))
    )
  })

  const list = Effect.fnUntraced(function* (kind: BuffCustom.Kind) {
    const registry = registries[kind.name]
    const visible = yield* registry.registered
    return BuffCustomList.entries({
      own: yield* own(kind),
      registered: [...visible, ...hidden[kind.name]],
      disabled: disabled[kind.name].ids(),
      configured: new Set((yield* files.documents).flatMap((document) => registry.configured(document.info))),
      trust:
        kind.name === "command"
          ? new Map([...(yield* projectCommands)].map(([id, source]) => [id, trust.ok(source.key, source.content)]))
          : undefined,
    })
  })

  // --- запись ---------------------------------------------------------------------------------

  const erase = Effect.fnUntraced(function* (kind: BuffCustom.Kind, scope: BuffCustom.Scope, id: string) {
    const item = yield* find(kind, scope, id)
    if (!item) return
    yield* fs.remove(item.file, { force: true }).pipe(
      Effect.mapError(
        (cause): Refusal => ({
          kind: "unwritable",
          message: BuffLocale.t("Could not delete {file}: {cause}", { file: item.file, cause: cause.message }),
        }),
      ),
    )
  })

  const settled = Effect.sleep(options.settle)
  const done = (kind: BuffCustom.Kind) =>
    Effect.gen(function* () {
      yield* settled
      yield* registries[kind.name].reload
      yield* changed
      return undefined
    })
  const refused =
    <A>(call: { error: (kind: Refusal["kind"], message: string, data: {}) => unknown }) =>
    (effect: Effect.Effect<A, Refusal>) =>
      effect.pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}) as never))

  const registration = yield* ctx.rpc
    .register(BuffCustom.Rpc, {
      list: (input) => list(BuffCustom.kinds[input.kind]),
      read: (input, call) =>
        Effect.gen(function* () {
          const kind = BuffCustom.kinds[input.kind]
          const item = yield* find(kind, input.scope, input.id)
          if (!item)
            return yield* refuse(
              "invalid",
              BuffLocale.t("«{id}» is not among yours: only your own entries can be edited.", { id: input.id }),
            )
          return BuffCustom.fileParts(kind, item.text)
        }).pipe(refused(call)),
      save: (input, call) =>
        Effect.gen(function* () {
          const kind = BuffCustom.kinds[input.kind]
          const problem = BuffCustom.problem(kind, input, BuffLocale.t)
          if (problem) return yield* refuse("invalid", problem)
          const kept = yield* find(kind, input.scope, input.id)
          yield* files.write(
            kept?.file ?? path.join(roots[input.scope], BuffCustom.fileName(kind, input.id)),
            BuffCustom.fileEdited(kind, kept?.text ?? "", input),
          )
          const previous = input.previous
          if (previous && (previous.scope !== input.scope || previous.id !== input.id))
            yield* erase(kind, previous.scope, previous.id)
          return yield* done(kind)
        }).pipe(refused(call)),
      remove: (input, call) => {
        const kind = BuffCustom.kinds[input.kind]
        return erase(kind, input.scope, input.id).pipe(Effect.andThen(done(kind)), refused(call))
      },
      enable: (input, call) =>
        Effect.gen(function* () {
          const kind = BuffCustom.kinds[input.kind]
          const locked = input.enabled ? undefined : yield* registries[kind.name].lock(input.id)
          if (locked) return yield* refuse("invalid", locked)
          yield* disabled[kind.name].set(input.id, input.enabled)
          return undefined
        }).pipe(refused(call)),
      review: (input, call) =>
        reviewed(BuffCustom.kinds[input.kind], input.id).pipe(
          Effect.map((source) => ({ text: source.content, token: BuffTrust.token(source.content) })),
          refused(call),
        ),
      trust: (input, call) =>
        Effect.gen(function* () {
          const kind = BuffCustom.kinds[input.kind]
          const source = yield* reviewed(kind, input.id)
          if (input.token === undefined) yield* trust.revoke(source.key)
          else if (!(yield* trust.confirm(source.key, source.content, input.token)))
            return yield* refuse(
              "invalid",
              BuffLocale.t("The text changed while you were looking at it. Check it again."),
            )
          return undefined
        }).pipe(refused(call)),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<
  Config.Service | Command.Service | Agent.Service | FSUtil.Service | Global.Service | Scope.Scope
>({
  id: "buff.custom",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx, { settle: "400 millis", userDirectory: (yield* Global.Service).config })
  }),
})
