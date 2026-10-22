// Connecting one provider (#584), ported from the Solid window's connect/controller.ts as a plain
// store: its methods (an API key, OAuth with a code or by waiting), the method's form, the
// authorization and its polling. Buff (#457, #458): the sign-in attempt is cancelled on the server
// when the dialog closes or a new code is asked for; a refused sign-in returns to the form with
// the address kept; an expired code says what to do.

import { signInFailure } from "@opencode/app/react-reuse/sign-in-failure"
import type {
  FormAnswer,
  IntegrationInfo,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
  OpenCodeClient,
} from "@opencode/client/promise"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { createStore } from "../../core/store"
import type { Data } from "../../core/data/data"

export type ProviderConnectMethod = Extract<IntegrationMethod, { type: "key" | "oauth" }>
export type Authorization = IntegrationOauthConnectOutput["data"]

export type ConnectionState = {
  loading: boolean
  integration?: IntegrationInfo
  methodIndex?: number
  authorization?: Authorization
  answer?: FormAnswer
  state?: "pending" | "complete" | "error" | "form"
  error?: string
}

export function createProviderConnection(options: {
  api: () => OpenCodeClient
  data: Pick<Data, "location">
  provider: string
  directory?: string
  /** «API key», the fallback method's label. */
  keyLabel: string
  /** The desktop app asks OpenCode Zen for its own client id. */
  desktop: boolean
  /** Buff's translator for the failure wording. */
  t: BuffI18n.T
  /** «Invalid code», when a code cannot be checked. */
  invalidCode: string
  onComplete: () => void
  pollInterval?: number
}) {
  const store = createStore<ConnectionState>({ loading: true })
  const location = options.directory ? { directory: options.directory } : undefined
  const integrationID = options.provider
  const polling: { generation: number; timer?: ReturnType<typeof setTimeout>; disposed: boolean } = {
    generation: 0,
    disposed: false,
  }
  // Buff (#457): the sign-in attempt the server can still cancel.
  const attempt: { open?: { attemptID: string } } = {}
  const set = (patch: Partial<ConnectionState>) => store.set((state) => ({ ...state, ...patch }))

  const methods = (): ProviderConnectMethod[] => {
    const values = store
      .get()
      .integration?.methods.filter(
        (method): method is ProviderConnectMethod => method.type === "key" || method.type === "oauth",
      )
    if (values?.length) return values
    return [{ type: "key", label: options.keyLabel }]
  }
  const current = () => {
    const index = store.get().methodIndex
    return index === undefined ? undefined : methods().at(index)
  }

  const cancelPolling = () => {
    polling.generation++
    clearTimeout(polling.timer)
    polling.timer = undefined
  }
  const finish = async () => {
    attempt.open = undefined
    cancelPolling()
    const reads = options.data.location
    reads.integration.invalidate(location)
    reads.provider.invalidate(location)
    reads.model.invalidate(location)
    await Promise.all([
      reads.integration.sync(location),
      reads.provider.sync(location),
      reads.model.sync(location),
    ]).catch(() => undefined)
    if (!polling.disposed) options.onComplete()
  }
  const cancel = () => {
    cancelPolling()
    const open = attempt.open
    attempt.open = undefined
    if (!open) return
    void options
      .api()
      .integration.oauth.cancel({ integrationID, attemptID: open.attemptID, location })
      .catch(() => undefined)
  }
  const poll = async (authorization: Authorization, generation: number) => {
    const result = await options
      .api()
      .integration.oauth.status({ integrationID, attemptID: authorization.attemptID, location })
      .then((response) => ({ ok: true as const, status: response.data }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (polling.disposed || generation !== polling.generation) return
    if (!result.ok) return set({ state: "error", error: signInFailure(result.error, undefined, options.t).message })
    if (result.status.status === "complete") return finish()
    if (result.status.status === "failed") return set({ state: "error", error: result.status.message })
    if (result.status.status === "expired") {
      attempt.open = undefined
      return set({ state: "error", error: options.t(BuffFirstRun.CODE_EXPIRED) })
    }
    polling.timer = setTimeout(() => void poll(authorization, generation), options.pollInterval ?? 1_000)
  }

  const select = async (index: number, answer?: FormAnswer) => {
    cancel()
    const generation = polling.generation
    const method = methods()[index]
    if (!method) return
    set({ methodIndex: index, authorization: undefined, answer: undefined, state: undefined, error: undefined })
    if (method.form?.length && !answer) return set({ state: "form" })
    if (method.type === "key") return set({ answer })
    if (method.form?.some((field) => field.type !== "string"))
      return set({ state: "error", error: "This authentication form contains unsupported fields" })
    set({ state: "pending", answer })
    const result = await options
      .api()
      .integration.oauth.connect({ integrationID, methodID: method.id, ...(answer ? { answer } : {}), location })
      .then((response) => ({ ok: true as const, authorization: withClient(response.data) }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (polling.disposed || generation !== polling.generation) return
    if (!result.ok) {
      const failure = signInFailure(result.error, method.form?.length ? answer : undefined, options.t)
      if (failure.back === "form") return set({ state: "form", error: failure.message, answer: failure.answer })
      return set({ state: "error", error: failure.message })
    }
    set({ state: "complete", authorization: result.authorization, error: undefined })
    if (result.authorization.mode !== "auto") return
    attempt.open = { attemptID: result.authorization.attemptID }
    void poll(result.authorization, generation)
  }
  const withClient = (authorization: Authorization): Authorization => {
    if (integrationID !== "opencode" || !options.desktop) return authorization
    const url = new URL(authorization.url)
    url.searchParams.set("client_id", "opencode-desktop")
    return { ...authorization, url: url.href }
  }

  return {
    store,
    methods,
    current,
    /**
     * Read the provider's integration; a single method is chosen at once. Loading again after
     * `dispose` revives the connection (StrictMode replays the mount effect); the earlier load's
     * answer is dropped.
     */
    async load() {
      polling.disposed = false
      const generation = polling.generation
      const integration = await options
        .api()
        .integration.get({ integrationID, location })
        .then((result) => result.data)
        .catch(() => undefined)
      if (polling.disposed || generation !== polling.generation) return
      set({ loading: false, integration })
      if (methods().length === 1) void select(0)
    },
    select,
    reset() {
      cancelPolling()
      set({ methodIndex: undefined, authorization: undefined, answer: undefined, state: undefined, error: undefined })
    },
    /** The same method with the same form answer, after a refusal or an expired code. */
    retry() {
      const state = store.get()
      if (state.methodIndex !== undefined) void select(state.methodIndex, state.answer)
    },
    cancel,
    async connectKey(key: string) {
      const answer = store.get().answer
      await options.api().integration.connect.key({ integrationID, location, key, ...(answer ? { answer } : {}) })
      await finish()
    },
    /** Finish a code-mode OAuth; resolves the problem to show, or nothing when connected. */
    async completeCode(code: string) {
      const authorization = store.get().authorization
      if (!authorization) return options.invalidCode
      const result = await options
        .api()
        .integration.oauth.complete({ integrationID, attemptID: authorization.attemptID, location, code })
        .then(() => ({ ok: true as const }))
        .catch((error: unknown) => ({ ok: false as const, error }))
      if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error)
        return message || options.invalidCode
      }
      await finish()
      return undefined
    },
    dispose() {
      polling.disposed = true
      cancel()
    },
  }
}

export type ProviderConnection = ReturnType<typeof createProviderConnection>
