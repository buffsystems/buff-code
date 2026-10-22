export * as BuffBillingReader from "./billing.js"

import { Effect } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { BuffBilling } from "@opencode/schema/buff-billing"
import type { BuffContext } from "@opencode/schema/buff-context"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { BuffModels } from "./models.js"
import { BuffLocale } from "./locale.js"

/**
 * Остаток и расход (#455): ядро спрашивает бэкенд через шлюз коннектора компании токеном
 * разработчика — для организации рабочего контекста каталога. Только чтение; чей расход
 * показывать, бэкенд берёт из токена. Ничего не хранится: клиенты спрашивают, когда нужно.
 */

export interface Deps {
  readonly signedIn: Effect.Effect<BuffModels.SignedIn | undefined>
  readonly choice: Effect.Effect<BuffContext.Choice | null>
}

type Failure = { readonly kind: "signed_out" | "no_context" | "unreachable"; readonly message: string }

export const register = Effect.fn("BuffBillingReader.register")(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  deps: Deps,
) {
  const read: Effect.Effect<BuffBilling.Info, Failure> = Effect.gen(function* () {
    const me = yield* deps.signedIn
    if (!me) return yield* Effect.fail<Failure>({ kind: "signed_out", message: BuffLocale.t("Not signed in to Buff.") })
    const choice = yield* deps.choice
    if (!choice)
      return yield* Effect.fail<Failure>({
        kind: "no_context",
        message: BuffLocale.t("No organization is chosen for this folder."),
      })
    const unreachable = (detail: string): Failure => ({
      kind: "unreachable",
      message: BuffLocale.t("Could not get the balance: {detail}", { detail }),
    })
    const response = yield* HttpClientRequest.post(`${me.connector}/v1/developer/billing`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe({ token: me.token, org: choice.org }),
      (request) => http.execute(request),
      Effect.mapError((cause) => unreachable(String(cause))),
    )
    const reply = yield* response.json.pipe(Effect.orElseSucceed(() => null))
    const refusal = (reply as { error?: unknown } | null)?.error
    if (response.status >= 400 || (reply as { ok?: unknown } | null)?.ok === false)
      return yield* Effect.fail(unreachable(typeof refusal === "string" ? refusal : BuffLocale.t("code {status}", { status: response.status })))
    const info = BuffBilling.fromReply(reply)
    if (!info) return yield* Effect.fail(unreachable(BuffLocale.t("the company connector does not know this request — update it")))
    return info
  })

  yield* ctx.rpc
    .register(BuffBilling.Rpc, {
      get: (_input, call) => read.pipe(Effect.mapError((f) => call.error(f.kind, f.message, {}))),
    })
    .pipe(Effect.orDie)
})
