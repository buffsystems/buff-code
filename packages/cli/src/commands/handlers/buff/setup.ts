import { log, spinner } from "@clack/prompts"
import { Effect } from "effect"
import type { OpenCodeClient } from "@opencode/client"
import { BuffContext } from "@opencode/schema/buff-context"
import { BuffLocale } from "@opencode/schema/buff-locale"
import { BuffRunner } from "@opencode/schema/buff-runner"
import { chooseOrg, chooseProject, chooseSpaces, launchStep, ownModel, setsUpBuff } from "@opencode/schema/buff-context-flow"
import { connectIntegration } from "../auth/login"
import { location, request } from "../auth/shared"
import { followLocale, t } from "../../../buff/locale"
import { consoleAsk, describe, type Choice } from "./context"

/**
 * Настройка при запуске (#401): разовая команда без входа в Buff или без рабочего
 * контекста спрашивает их на месте — вход через коннектор компании, затем организация и
 * проект — и продолжает. Отдельных команд для этого нет. Без терминала спросить некого:
 * тогда короткая ошибка. Вход в Buff не обязателен (#562): команда на своей модели — названной
 * в `model` или своего подключённого провайдера — Buff не настраивает.
 */

const NOT_SET_UP =
  "Buff Code is not set up: run buff to sign in to Buff, or connect your own provider with buff auth login"

const failure = (error: unknown) => ({
  type: typeof error === "object" && error !== null && "type" in error ? String(error.type) : undefined,
  message: typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error),
})

const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)

/** Подключён ли свой провайдер: в списке моделей есть своя (`ownModel`). */
const ownConnected = (client: OpenCodeClient) =>
  Effect.promise(() =>
    client.model.list({ location }).then(
      (response) => response.data.some(ownModel),
      () => false,
    ),
  )

export const setupBuff = Effect.fn("cli.buff.setup")(function* (
  client: OpenCodeClient,
  own: { readonly model?: string } = {},
) {
  // Раннер пайплайна (#439): контекст прогона пришёл окружением, входа и выбора нет —
  // и rpc контекста на сервере тоже нет, его плагин в этом режиме не запускается.
  if (BuffRunner.parse(process.env)) return null
  const rpc = client.rpc(BuffContext.Rpc)
  // rpc ждёт загрузки плагинов, а с ней — и моделей организации (#399): отсюда индикатор.
  const progress = process.stderr.isTTY ? spinner({ output: process.stderr }) : undefined
  progress?.start(t("Loading Buff…"))
  yield* Effect.promise(() => followLocale(() => client.rpc(BuffLocale.Rpc).get(undefined, { location })))
  const saved = yield* Effect.promise(() => rpc.get(undefined, { location }).catch(() => null))
  // Ответ, в котором нет списка организаций, — не Buff: чужой сервер, настраивать нечего.
  const problem = yield* Effect.promise(() =>
    rpc.options(undefined, { location }).then(
      (options) => (Array.isArray(options?.orgs) ? undefined : { type: undefined, message: t("There is no Buff on the server") }),
      failure,
    ),
  )
  progress?.stop(saved && !problem ? describe(saved) : t("Buff is not set up yet"))
  const step = launchStep(saved, problem)
  if (step === "ready") return saved as Choice
  if (step === "absent") return null
  const connected = !own.model && step === "sign_in" ? yield* ownConnected(client) : false
  if (!setsUpBuff(step, { model: own.model, connected })) return null
  if (step === "unreachable") return yield* Effect.fail(new Error(problem!.message))
  if (!interactive()) return yield* Effect.fail(new Error(t(NOT_SET_UP)))
  if (step === "sign_in") {
    log.info(t("Sign-in to Buff goes through your company connector"))
    yield* connectIntegration(client, "buff")
    const after = yield* Effect.promise(() => rpc.get(undefined, { location }).catch(() => null))
    if (after) return after
  }
  const options = yield* request(() => rpc.options(undefined, { location })).pipe(
    Effect.mapError((error) => new Error(failure(error).message)),
  )
  const cancelled = () => Effect.fail(new Error(t("Cancelled")))
  const org = yield* Effect.promise(() => chooseOrg(consoleAsk, options, null))
  if (org === undefined) return yield* cancelled()
  const project = yield* Effect.promise(() => chooseProject(consoleAsk, options, org, undefined))
  if (project === undefined) return yield* cancelled()
  const spaces = yield* Effect.promise(() => chooseSpaces(consoleAsk, options, org, []))
  if (spaces === undefined) return yield* cancelled()
  const kept = yield* request(() => rpc.set({ org, project, spaces }, { location })).pipe(
    Effect.mapError((error) => new Error(failure(error).message)),
  )
  log.success(t("Context: {context} · change it with /org and /project in buff", { context: describe(kept) }))
  return kept
})
