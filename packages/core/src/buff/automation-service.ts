export * as BuffAutomationService from "./automation-service.js"

import { Cause, Context, Duration, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { turnFailure } from "@opencode/schema/buff-turn-failure"
import { BuffLocale } from "./locale.js"
import { Location } from "@opencode/schema/location"
import { Model } from "@opencode/schema/model"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { KV } from "../kv.js"
import { Permission } from "../permission.js"
import { storage } from "../plugin/host.js"
import { Session } from "../session.js"
import { SessionEvent } from "../session/event.js"
import { SessionSchema } from "../session/schema.js"
import { BuffAutomationRunner } from "./automation-runner.js"
import { BuffAutomationStore } from "./automation-store.js"

/**
 * Служба автоматизаций (#447) — одна на процесс, не на каталог: каталоги выгружаются через час
 * простоя, а расписание должно идти и при закрытом окне. Часы (`start`) включает только
 * управляемая служба Buff Code — она одна на машину; консоль без службы (`--standalone`)
 * автоматизации видит и правит, но не запускает по расписанию, иначе запуски бы дублировались.
 */

type Saved = { readonly automation?: BuffAutomation.Automation; readonly problem?: string }

export interface Interface {
  readonly list: () => Effect.Effect<readonly BuffAutomation.Automation[]>
  readonly save: (id: string | undefined, draft: BuffAutomation.Draft) => Effect.Effect<Saved>
  readonly remove: (id: string) => Effect.Effect<boolean>
  readonly pause: (id: string, paused: boolean) => Effect.Effect<Saved>
  readonly run: (id: string) => Effect.Effect<{ readonly run?: BuffAutomation.Run; readonly problem?: string }>
  readonly stop: (id: string) => Effect.Effect<{ readonly stopped: boolean }>
  readonly runs: (id: string) => Effect.Effect<readonly BuffAutomation.Run[]>
  readonly removeRun: (id: string, run: string) => Effect.Effect<boolean>
  /** Часы и наблюдение за запусками — пока жива область. */
  readonly start: Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@buff/AutomationService") {}

/** Как часто служба смотрит на сроки (опоздание — дольше `BuffSchedule.LATE_AFTER_MS`). */
const TICK = Duration.seconds(30)
const decodeModel = Schema.decodeUnknownSync(Model.Ref)
const decodeLocation = Schema.decodeUnknownSync(Location.Ref)

const reason = (cause: unknown): string =>
  typeof cause === "object" &&
  cause !== null &&
  "message" in cause &&
  typeof cause.message === "string" &&
  cause.message
    ? cause.message
    : "The run session could not be started."

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service
    const lock = yield* Semaphore.make(1)
    const locked = <A>(effect: Effect.Effect<A>) => lock.withPermits(1)(effect)
    let sequence = 0
    const deps: BuffAutomationRunner.Deps = {
      store: BuffAutomationStore.make(storage(kv, "buff.automation")),
      now: () => Date.now(),
      // Растёт со временем: по нему история идёт по порядку.
      id: () => `${String(Date.now()).padStart(13, "0")}${String(++sequence).padStart(6, "0")}`,
      launch: (automation, run) =>
        Effect.gen(function* () {
          const session = yield* sessions.create({
            title: automation.title,
            ...(automation.model ? { model: decodeModel(automation.model) } : {}),
            permissions: [...BuffPermissionMode.rules(automation.mode, false)],
            metadata: { [BuffAutomation.SESSION_KEY]: { id: automation.id, run: run.id, title: automation.title } },
            location: decodeLocation({ directory: automation.directory }),
          })
          yield* sessions.prompt({ sessionID: session.id, text: automation.prompt })
          return session.id as string
        }).pipe(Effect.catchCause((cause) => Effect.fail(reason(Cause.squash(cause))))),
      interrupt: (session) => sessions.interrupt(SessionSchema.ID.make(session)),
    }

    const failure = (sessionID: SessionSchema.ID, error: { type: string; message: string; status?: number }) =>
      sessions.get(sessionID).pipe(
        Effect.map((session) => turnFailure(error, session.model?.providerID ?? "", BuffLocale.t).text),
        Effect.orElseSucceed(() => error.message),
      )

    const watch = bus
      .subscribe([
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
        Permission.Event.Asked,
        Permission.Event.Replied,
      ])
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const session = event.data.sessionID
            const change: BuffAutomationRunner.Change =
              event.type === "session.execution.succeeded"
                ? { type: "succeeded" }
                : event.type === "session.execution.failed"
                  ? { type: "failed", error: yield* failure(session, event.data.error) }
                  : event.type === "session.execution.interrupted"
                    ? { type: "interrupted", reason: event.data.reason }
                    : event.type === "permission.asked"
                      ? { type: "asked" }
                      : { type: "replied" }
            yield* locked(BuffAutomationRunner.settle(deps, session, change))
          }),
        ),
      )

    // Запуск кончился, пока служба не слушала (упала между событием и записью): итог — из сессии.
    const reconcile = Effect.gen(function* () {
      const active = yield* sessions.active
      for (const automation of yield* deps.store.list()) {
        const session = automation.last?.session
        if (!session || active.has(SessionSchema.ID.make(session))) continue
        const info = Option.getOrUndefined(yield* sessions.get(SessionSchema.ID.make(session)).pipe(Effect.option))
        const change: BuffAutomationRunner.Change | undefined =
          info?.outcome === "succeeded"
            ? { type: "succeeded" }
            : info?.outcome === "failed"
              ? { type: "failed", error: "" }
              : // Прерванную перезапуском сессию служба возобновит сама — запуск ещё идёт.
                undefined
        if (change) yield* locked(BuffAutomationRunner.settle(deps, session, change))
      }
    })

    const clock = locked(BuffAutomationRunner.tick(deps)).pipe(
      Effect.catchCause((cause) => Effect.logError("buff automation tick failed", { cause })),
      Effect.andThen(Effect.sleep(TICK)),
      Effect.forever,
    )

    return Service.of({
      list: () => deps.store.list(),
      save: (id, draft) => locked(BuffAutomationRunner.save(deps, id, draft)),
      remove: (id) => locked(deps.store.remove(id)),
      pause: (id, paused) => locked(BuffAutomationRunner.pause(deps, id, paused)),
      run: (id) => locked(BuffAutomationRunner.runNow(deps, id)),
      stop: (id) => locked(BuffAutomationRunner.stop(deps, id)),
      runs: (id) => deps.store.runs(id),
      removeRun: (id, run) => locked(deps.store.removeRun(id, run)),
      start: Effect.all([Effect.forkScoped(watch), Effect.forkScoped(reconcile.pipe(Effect.andThen(clock)))], {
        discard: true,
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node, Bus.node] })
