export * as DesktopInitialization from "./desktop-initialization"

import * as BuffNetworkStore from "../buff/network-store"
import { app } from "electron"
import { Context, Effect, Layer } from "effect"
import { DesktopLogging } from "../native/logging"
import { getStore } from "../storage/store"
import { marks } from "./marks"
import {
  loadProxyEnvironment,
  preferApplicationEnvironment,
  prepareApplicationEnvironment,
  prepareDesktop,
} from "./environment"

export interface Interface {
  readonly version: string
  readonly updaterStore: ReturnType<typeof getStore>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopInitialization") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const logging = yield* DesktopLogging.Service
    yield* preferApplicationEnvironment
    // System certificates, the proxy and the net log serve later network work; the first window and
    // its IPC port do not wait for them.
    yield* Effect.forkScoped(
      prepareApplicationEnvironment.pipe(Effect.andThen(loadProxyEnvironment), Effect.andThen(logging.startNetwork)),
    )
    yield* Effect.promise(() => app.whenReady())
    // Buff (#461): прокси и сертификат из настроек — до запуска службы, она их наследует.
    yield* Effect.sync(BuffNetworkStore.apply)
    yield* prepareDesktop
    marks.init = Date.now()
    return Service.of({
      version: app.getVersion(),
      updaterStore: getStore("opencode.updater"),
    })
  }),
)
