export * as BuffHookPlugin from "./hook.js"

import path from "node:path"
import { BuffProjectDir } from "./project-dir.js"
import { Duration, Effect } from "effect"
import type { Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffHook } from "@opencode/schema/buff-hook"
import { Tool } from "@opencode/schema/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { ShellSelect } from "../shell/select.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffDisabled } from "./disabled.js"
import { BuffLocale } from "./locale.js"
import { BuffTrust } from "./trust.js"

/**
 * Хуки (#446): команда оболочки на событие агента. Записаны в `hooks.json` — у пользователя
 * (все проекты) и в каталоге Buff Code проекта (.buffcode, у старых — .opencode); файлы читаются в момент события, так что правка
 * действует сразу. Хук проекта не выполняется, пока человек не посмотрел его и не подтвердил;
 * изменился хук — подтверждение спрашивается заново. Что выключено и что подтверждено,
 * хранится у пользователя.
 */

const FILE = "hooks.json"
const { refuse } = BuffConfigFiles
type Refusal = BuffConfigFiles.Refusal

export interface Options {
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
}

export const register = Effect.fn("BuffHook.register")(function* (ctx: Context, options: Options) {
  const fs = yield* FSUtil.Service
  const processes = yield* AppProcess.Service
  const shells = yield* ShellSelect.Service
  const files: Record<BuffHook.Scope, string> = {
    user: path.join(options.userDirectory, FILE),
    project: path.join(BuffProjectDir.of(ctx.location.project.directory), FILE),
  }
  // Выключенное и подтверждённое — общие для всех открытых каталогов.
  let changed: Effect.Effect<void> = Effect.void
  const told = Effect.suspend(() => changed)
  const disabled = yield* BuffDisabled.make(ctx.storage, "disabled-hooks", told)
  const trust = yield* BuffTrust.make(ctx.storage, "trusted-hooks", told)
  // Ключ — проект и имя, а не путь файла: в рабочих деревьях проекта хук один и тот же.
  const owner: Record<BuffHook.Scope, string> = { user: "user", project: ctx.location.project.canonical }
  const switchKey = (scope: BuffHook.Scope, id: string) => `${owner[scope]}#${id}`

  const text = (scope: BuffHook.Scope) =>
    fs.readFileStringSafe(files[scope]).pipe(
      Effect.map((content) => content ?? ""),
      Effect.orElseSucceed(() => ""),
    )

  /** Все хуки каталога, как они записаны: пользователя, затем проекта. */
  const list = Effect.gen(function* () {
    const entries: BuffHook.Entry[] = []
    for (const scope of ["user", "project"] as const)
      for (const hook of BuffHook.fileHooks(yield* text(scope))) {
        const key = switchKey(scope, hook.id)
        entries.push({
          ...hook,
          scope,
          path: files[scope],
          enabled: !disabled.has(key),
          ...(scope === "project" ? { trusted: trust.ok(key, BuffHook.reviewText(hook)) } : {}),
        })
      }
    return entries
  })

  // --- исполнение -----------------------------------------------------------------------------

  const fired = (event: BuffHook.Event, tool?: string) =>
    list.pipe(
      Effect.map((entries) =>
        entries.filter((entry) => entry.enabled && entry.trusted !== false && BuffHook.matches(entry, event, tool)),
      ),
    )

  /** Запустить команду хука: событие — в stdin и в переменной BUFF_HOOK_EVENT. */
  const run = Effect.fnUntraced(function* (hook: BuffHook.Hook, payload: string) {
    const shell = yield* shells.resolve({ priority: "config" })
    return yield* processes
      .run(
        ChildProcess.make(shell, ShellSelect.args(shell, hook.command), {
          cwd: ctx.location.directory,
          env: { BUFF_HOOK_EVENT: payload, BUFF_HOOK_ID: hook.id },
          extendEnv: true,
        }),
        { combineOutput: true, stdin: payload },
      )
      .pipe(
        Effect.map((result) => ({
          code: result.exitCode,
          output: (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8"),
        })),
        Effect.catch((error) => Effect.succeed({ code: -1, output: `the command did not start: ${error.message}` })),
      )
  })
  const about = (session: string) => ({ directory: ctx.location.directory, session })

  yield* ctx.tool.hook("execute.before", (event) =>
    Effect.gen(function* () {
      const payload = BuffHook.payload({
        event: "tool.before",
        ...about(String(event.sessionID)),
        tool: event.tool,
        input: event.input,
      })
      for (const hook of yield* fired("tool.before", event.tool)) {
        const result = yield* run(hook, payload)
        const refusal = BuffHook.verdict(hook, result.code, result.output)
        if (refusal) return yield* new Tool.Error({ message: refusal })
      }
    }),
  )
  yield* ctx.tool.hook("execute.after", (event) =>
    Effect.gen(function* () {
      const payload = BuffHook.payload({
        event: "tool.after",
        ...about(String(event.sessionID)),
        tool: event.tool,
        input: event.input,
      })
      for (const hook of yield* fired("tool.after", event.tool)) {
        const result = yield* run(hook, payload)
        if (result.code !== 0) yield* Effect.logWarning("hook failed", { hook: hook.id, ...result })
      }
    }),
  )
  yield* ctx.session.hook("prompt", (event) =>
    Effect.gen(function* () {
      const payload = BuffHook.payload({
        event: "prompt",
        ...about(String(event.sessionID)),
        prompt: event.prompt.text,
      })
      for (const hook of yield* fired("prompt")) {
        const result = yield* run(hook, payload)
        if (result.code !== 0) yield* Effect.logWarning("hook failed", { hook: hook.id, ...result })
        else if (result.output.trim()) event.prompt.text = `${event.prompt.text}\n\n${result.output.trim()}`
      }
    }),
  )

  // --- запись ---------------------------------------------------------------------------------

  const rewrite = (scope: BuffHook.Scope, change: (text: string) => string) =>
    Effect.gen(function* () {
      const before = yield* text(scope)
      const after = yield* Effect.try({
        try: () => change(before),
        catch: (cause): Refusal => ({
          kind: "unwritable",
          message: cause instanceof Error ? BuffLocale.t(cause.message) : String(cause),
        }),
      })
      if (after === before) return
      yield* fs.writeWithDirs(files[scope], after).pipe(
        Effect.mapError(
          (cause): Refusal => ({
            kind: "unwritable",
            message: BuffLocale.t("Could not write {file}: {cause}", { file: files[scope], cause: cause.message }),
          }),
        ),
      )
    })
  const projectHook = Effect.fnUntraced(function* (id: string) {
    const hook = BuffHook.fileHooks(yield* text("project")).find((item) => item.id === id)
    return hook ?? (yield* refuse("invalid", BuffLocale.t("There is no hook «{id}» in the project.", { id })))
  })

  const done = Effect.suspend(() => changed).pipe(Effect.as(undefined))
  const refused =
    <A>(call: { error: (kind: Refusal["kind"], message: string, data: {}) => unknown }) =>
    (effect: Effect.Effect<A, Refusal>) =>
      effect.pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}) as never))

  const registration = yield* ctx.rpc
    .register(BuffHook.Rpc, {
      list: () => list,
      save: (input, call) =>
        Effect.gen(function* () {
          const hook: BuffHook.Hook = {
            id: input.id.trim(),
            event: input.event,
            tool: input.tool,
            command: input.command,
          }
          const problem = BuffHook.problem(hook, BuffLocale.t)
          if (problem) return yield* refuse("invalid", problem)
          const previous = input.previous
          yield* rewrite(input.scope, (before) =>
            BuffHook.fileWith(before, hook, previous?.scope === input.scope ? previous.id : undefined),
          )
          if (previous && previous.scope !== input.scope)
            yield* rewrite(previous.scope, (before) => BuffHook.fileWithout(before, previous.id))
          return yield* done
        }).pipe(refused(call)),
      remove: (input, call) =>
        rewrite(input.scope, (before) => BuffHook.fileWithout(before, input.id)).pipe(
          Effect.andThen(done),
          refused(call),
        ),
      enable: (input) => disabled.set(switchKey(input.scope, input.id), input.enabled).pipe(Effect.as(undefined)),
      review: (input, call) =>
        projectHook(input.id).pipe(
          Effect.map((hook) => {
            // Отпечаток — от английского текста, чтобы доверие не зависело от языка; человеку — перевод.
            return { text: BuffHook.reviewText(hook, BuffLocale.t), token: BuffTrust.token(BuffHook.reviewText(hook)) }
          }),
          refused(call),
        ),
      trust: (input, call) =>
        Effect.gen(function* () {
          const hook = yield* projectHook(input.id)
          const key = switchKey("project", hook.id)
          if (input.token === undefined) yield* trust.revoke(key)
          else if (!(yield* trust.confirm(key, BuffHook.reviewText(hook), input.token)))
            return yield* refuse(
              "invalid",
              BuffLocale.t("The hook changed while you were looking at it. Check it again."),
            )
          return undefined
        }).pipe(refused(call)),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<FSUtil.Service | Global.Service | AppProcess.Service | ShellSelect.Service | Scope.Scope>({
  id: "buff.hook",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx, { userDirectory: (yield* Global.Service).config })
  }),
})
