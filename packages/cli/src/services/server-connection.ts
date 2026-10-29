import { Service, type Endpoint, type EnsureOptions } from "@opencode/client/effect/service"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode/client/promise"
import { OPENCODE_VERSION } from "../version"
import { Effect, Redacted } from "effect"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"
import { Env } from "../env"
import { ServiceConfig } from "./service-config"
import { Standalone } from "./standalone"
import { t } from "../buff/locale"

export type Args = {
  readonly server?: string
  readonly standalone?: boolean
  readonly mismatch?: "replace" | "ignore" | "error"
  readonly onStart?: EnsureOptions["onStart"]
}

export type Resolved = {
  readonly endpoint: Endpoint
  readonly service?: ReturnType<typeof managedService>
}

export const resolve = Effect.fn("cli.server-connection.resolve")(function* (args: Args) {
  if (args.server !== undefined && args.standalone)
    return yield* Effect.fail(new Error(t("--server and --standalone cannot be combined")))
  if (args.server !== undefined) {
    const password = yield* Env.password
    const endpoint = {
      url: args.server,
      // Сервер по адресу может быть прежнего выпуска — ему понятно только прежнее имя.
      auth: password
        ? { type: "basic" as const, username: BuffServerAuth.LEGACY_USERNAME, password: Redacted.value(password) }
        : undefined,
    } satisfies Endpoint
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const health = yield* Effect.tryPromise({
      try: () => client.server.info({ signal: AbortSignal.timeout(5_000) }),
      catch: (cause) => connectError(endpoint, cause),
    })
    if (health.version !== OPENCODE_VERSION)
      process.stderr.write(
        t("Warning: Server at {url} has version {server}; this client is {client}. Continuing anyway.", {
          url: endpoint.url,
          server: health.version,
          client: OPENCODE_VERSION,
        }) + "\n",
      )
    return { endpoint } satisfies Resolved
  }
  if (args.standalone) {
    return { endpoint: yield* Standalone.start() } satisfies Resolved
  }

  const mismatch = args.mismatch ?? "ignore"
  const options = yield* ServiceConfig.options({ checkVersion: mismatch !== "ignore" })
  return {
    endpoint: yield* resolveManaged({ ...options, onStart: args.onStart }, mismatch),
    service: managedService(options),
  } satisfies Resolved
})

function managedService(options: EnsureOptions) {
  const reconnectOptions = { ...options, version: undefined }
  return {
    reconnect: () => Service.ensure(reconnectOptions),
    restart: () =>
      Effect.gen(function* () {
        yield* Service.stop({ file: options.file, pty: "handoff" })
        yield* Service.ensure(reconnectOptions)
      }),
  }
}

export const shutdownPersistentPty = Effect.fn("cli.server-connection.shutdown-persistent-pty")(function* (
  options: EnsureOptions,
) {
  const endpoint = yield* Service.discover({ ...options, version: undefined })
  if (!endpoint) return
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  yield* Effect.tryPromise(() => client.experimental.persistentPty.shutdown())
})

const resolveManaged = Effect.fnUntraced(function* (options: EnsureOptions, mismatch: NonNullable<Args["mismatch"]>) {
  if (mismatch === "replace") return yield* Service.ensure(options)
  if (mismatch === "ignore") return yield* Service.ensure({ ...options, version: undefined })

  const compatible = yield* Service.discover(options)
  if (compatible !== undefined) return compatible
  const existing = yield* Service.discover({ ...options, version: undefined })
  if (existing !== undefined)
    return yield* Effect.fail(new Error(t("Background server version does not match this client")))
  return yield* Service.ensure(options)
})

function connectError(endpoint: Endpoint, cause: unknown) {
  if (isUnauthorizedError(cause)) {
    return new Error(
      endpoint.auth === undefined
        ? t("Server at {url} requires a password; set OPENCODE_PASSWORD", { url: endpoint.url })
        : t("Server at {url} rejected the password", { url: endpoint.url }),
      { cause },
    )
  }
  if (cause instanceof ClientError && cause.reason === "Transport")
    return new Error(t("Could not reach server at {url}", { url: endpoint.url }), { cause })
  return new Error(t("Server at {url} did not provide a compatible V2 health response", { url: endpoint.url }), {
    cause,
  })
}

export * as ServerConnection from "./server-connection"
