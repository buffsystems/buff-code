export * as BuffGitPlugin from "./git.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffGit } from "@opencode/schema/buff-git"
import { SessionID } from "@opencode/schema/session-id"
import { AppProcess } from "@opencode/util/process"
import { gitExecutable } from "../util/git-executable.js"
import { commitMessage, commitPrompt, newFilesMissingFromDiff } from "./commit-prompt.js"
import { BuffLocale } from "./locale.js"

/**
 * Git из интерфейса (#454): ветки, коммит, отправка, история. Ядро апстрима умеет git только
 * читать; здесь — команды записи, которые человек иначе набирал бы в терминале. Команды
 * выполняются в каталоге сессии обычным git, ничего не настраивая и не обходя: что откажет git,
 * то и будет показано человеку словами.
 */

type Refusal = { readonly kind: "invalid" | "failed"; readonly message: string }
const refuse = (kind: Refusal["kind"], message: string) => Effect.fail<Refusal>({ kind, message })

export const register = Effect.fn("BuffGit.register")(function* (ctx: Context) {
  const processes = yield* AppProcess.Service
  const cwd = ctx.location.directory

  /** Выполнить git; вопросов о пароле не задаём — отказ вернётся ошибкой. */
  const git = (...args: string[]) =>
    processes
      .run(
        ChildProcess.make(gitExecutable, ["-c", "core.quotepath=false", ...args], {
          cwd,
          env: { GIT_TERMINAL_PROMPT: "0" },
          extendEnv: true,
          stdin: "ignore",
        }),
      )
      .pipe(
        Effect.map((result) => ({
          ok: result.exitCode === 0,
          out: result.stdout.toString("utf8"),
          error: result.stderr.toString("utf8").trim(),
        })),
        Effect.catch((error) => Effect.succeed({ ok: false, out: "", error: error.message })),
      )
  /** То же, но отказ git — отказ запроса. */
  const must = (...args: string[]) =>
    git(...args).pipe(
      Effect.flatMap((result) =>
        result.ok ? Effect.succeed(result.out) : refuse("failed", result.error || result.out),
      ),
    )

  const state = Effect.gen(function* () {
    const status = yield* must("status", "--porcelain=v1", "--untracked-files=all", "-z")
    const branch = (yield* git("symbolic-ref", "--quiet", "--short", "HEAD")).out.trim() || undefined
    const upstream =
      (yield* git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")).out.trim() || undefined
    const counts = upstream ? (yield* git("rev-list", "--left-right", "--count", `HEAD...${upstream}`)).out : ""
    return {
      ...(branch ? { branch } : {}),
      ...(upstream ? { upstream } : {}),
      ...BuffGit.aheadBehind(counts),
      changes: BuffGit.changes(status),
    } satisfies BuffGit.State
  })

  const branches = must("for-each-ref", "--format=%(refname:short)", "refs/heads").pipe(
    Effect.map((out) => out.split("\n").filter(Boolean)),
  )

  let changed: Effect.Effect<void> = Effect.void
  /** После записи — свежее состояние и весть экранам. */
  const done = Effect.gen(function* () {
    const next = yield* state
    yield* changed
    return next
  })
  const refused =
    <A>(call: { error: (kind: Refusal["kind"], message: string, data: {}) => unknown }) =>
    (effect: Effect.Effect<A, Refusal>) =>
      effect.pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}) as never))

  const registration = yield* ctx.rpc
    .register(BuffGit.Rpc, {
      state: (_input, call) => state.pipe(refused(call)),
      branches: (_input, call) => branches.pipe(refused(call)),
      switch: (input, call) =>
        Effect.gen(function* () {
          const branch = input.branch.trim()
          if (input.create) {
            const problem = BuffGit.branchProblem(branch, yield* branches, BuffLocale.t)
            if (problem) return yield* refuse("invalid", problem)
            yield* must("switch", "-c", branch)
          } else yield* must("switch", branch)
          return yield* done
        }).pipe(refused(call)),
      commit: (input, call) =>
        Effect.gen(function* () {
          const problem = BuffGit.commitProblem(input, BuffLocale.t)
          if (problem) return yield* refuse("invalid", problem)
          const current = yield* state
          const selected = current.changes.filter((change) => input.files.includes(change.file))
          if (!selected.length)
            return yield* refuse(
              "invalid",
              BuffLocale.t("The ticked files are no longer among the changes — refresh the list."),
            )
          // Новое добавляем в индекс; изменённое и удалённое коммит берёт из рабочей копии сам.
          // Пути переименования — оба: изменение входит в коммит целиком.
          const stage = BuffGit.toStage(selected)
          if (stage.length) yield* must("add", "--", ...stage)
          yield* must("commit", "--message", input.message.trim(), "--", ...BuffGit.paths(selected))
          return yield* done
        }).pipe(refused(call)),
      push: (_input, call) =>
        Effect.gen(function* () {
          const current = yield* state
          if (!current.branch)
            return yield* refuse("invalid", BuffLocale.t("HEAD is not on a branch — nothing to push. Create a branch."))
          const pushed = yield* git(
            ...(current.upstream ? ["push"] : ["push", "--set-upstream", "origin", current.branch]),
          )
          if (!pushed.ok) return yield* refuse("failed", BuffGit.pushProblem(pushed.error || pushed.out, BuffLocale.t))
          return yield* done
        }).pipe(refused(call)),
      message: (input, call) =>
        Effect.gen(function* () {
          const current = yield* state
          const selected = current.changes.filter((change) => input.files.includes(change.file))
          if (!selected.length)
            return yield* refuse(
              "invalid",
              BuffLocale.t("Tick the files — the message is composed from their changes."),
            )
          const recent = (yield* git("log", "-10", "--pretty=format:%s")).out
          const tracked = (yield* git("diff", "HEAD", "--", ...BuffGit.paths(selected))).out
          // Новые файлы, которых git ещё не знает, — целиком (`--no-index` выходит с кодом 1 при отличиях).
          const fresh = yield* Effect.forEach(newFilesMissingFromDiff(selected, tracked), (file) =>
            git("diff", "--no-index", "--", "/dev/null", file).pipe(Effect.map((result) => result.out)),
          )
          const diff = [tracked, ...fresh].filter((part) => part.trim()).join("\n")
          const prompt = commitPrompt({
            recent,
            files: selected.map((change) => `${BuffGit.changeLabel(change)}: ${change.file}`).join("\n"),
            diff,
          })
          const answer = yield* (
            input.sessionID
              ? ctx.session.generate({ sessionID: SessionID.make(input.sessionID), prompt })
              : ctx.generate.text({ prompt })
          ).pipe(
            Effect.mapError(
              (cause): Refusal => ({
                kind: "failed",
                // Вне сессии у вызова нет рабочего контекста — модель Buff отказывает без организации.
                message: input.sessionID
                  ? BuffLocale.t("The model did not answer: {message}", {
                      message: String((cause as { message?: unknown }).message ?? cause),
                    })
                  : BuffLocale.t(
                      "Send the first message of the session: the commit message is composed in its context.",
                    ),
              }),
            ),
          )
          const message = commitMessage(answer.text)
          if (!message)
            return yield* refuse(
              "failed",
              BuffLocale.t("The model did not suggest a message — write it yourself or try again."),
            )
          return { message }
        }).pipe(refused(call)),
      log: (input, call) =>
        git(
          "log",
          "--all",
          "--date-order",
          `--skip=${Math.max(0, Math.floor(input.skip))}`,
          `--max-count=${Math.max(1, Math.floor(input.count))}`,
          `--pretty=format:${BuffGit.LOG_FORMAT}`,
        ).pipe(
          // В репозитории без единого коммита истории нет — это не ошибка.
          Effect.map((result) => (result.ok ? BuffGit.commits(result.out) : [])),
          refused(call),
        ),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<AppProcess.Service | Scope.Scope>({
  id: "buff.git",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx)
  }),
})
