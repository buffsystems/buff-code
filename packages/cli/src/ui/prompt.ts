import { cancel, isCancel, log, outro } from "@clack/prompts"
import { Effect } from "effect"
import { errorMessage } from "../util/error"
import { t } from "../buff/locale"

const cancelled = Symbol("cancelled")

export function prompt<A>(run: () => Promise<A | symbol>) {
  return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.flatMap((value) => (isCancel(value) ? Effect.fail(cancelled) : Effect.succeed(value))),
  )
}

export function requireInteractive(message: string) {
  if (process.stdin.isTTY && process.stdout.isTTY) return Effect.void
  return Effect.fail(new Error(message))
}

// Открыть браузер — лишь удобство: ссылка уже на экране. Нечем открыть (сервер по SSH,
// контейнер) — вход идёт дальше, а не падает (#401): `open` сообщает об этом событием error
// запущенного процесса, и без слушателя оно становится необработанным исключением.
export const openUrl = Effect.fn("cli.prompt.open-url")(function* (url: string) {
  yield* Effect.tryPromise(() =>
    import("open")
      .then(({ default: open }) => open(url))
      .then((child) => void child.on("error", () => undefined)),
  ).pipe(Effect.ignore)
})

export function handlePromptErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error) => error === cancelled,
      () =>
        Effect.sync(() => {
          cancel(t("Cancelled"))
          process.exitCode = 130
        }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        log.error(errorMessage(error))
        outro(t("Command failed"))
        process.exitCode = 1
      }),
    ),
  )
}
