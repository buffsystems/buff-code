export * as WorkflowExecute from "./execute.js"

import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import vm from "node:vm"
import type { WorkflowCompile } from "./compile.js"
import type { WorkflowSchemaOf } from "./schema-of.js"
import prelude from "./prelude.txt" with { type: "text" }

/**
 * Исполнение сценария (#448): скрипт идёт в песочнице `node:vm` с фасадом из `prelude.txt`;
 * всё, что меняет мир или стоит денег, — через хоста (`Host`). Каждый шаг, наблюдение и
 * публикация — в журнале: повторный прогон по тому же журналу берёт сделанное оттуда и не
 * платит второй раз. Остановку (человеком или поставщиком модели) скрипт не видит — прогон
 * просто заканчивается остановленным.
 */

export interface ActorRef {
  readonly key: string
  readonly name?: string
  readonly role?: string
}

export interface Host {
  readonly actor: (actor: ActorRef) => void
  /** Задание актёру; отклонение — ошибка, которую скрипт может поймать; `ProviderStop` — останов прогона. */
  readonly ask: (input: {
    readonly actor: ActorRef
    readonly instructions: string
    readonly schema?: WorkflowSchemaOf.JsonSchema
    readonly phase?: string
    readonly key: string
  }) => Promise<unknown>
  /** Шаг взят из журнала — для хода прогона. */
  readonly cached: (input: {
    readonly actor: ActorRef
    readonly instructions: string
    readonly phase?: string
    readonly key: string
  }) => void
  readonly observe: (input: {
    readonly op: string
    readonly args: readonly unknown[]
    readonly phase?: string
  }) => Promise<unknown>
  readonly log: (text: string) => void
  readonly report: (item: unknown, tag?: string) => void
  readonly publish: (input: {
    readonly kind: string
    readonly id: string
    readonly path?: string
    readonly content?: string
    readonly options?: unknown
  }) => Promise<unknown>
  readonly declare: (input: { readonly kind: string; readonly id: string; readonly spec: unknown }) => void
}

export interface Entry {
  readonly value?: unknown
  readonly error?: string
}
export interface Journal {
  readonly get: (key: string) => Entry | undefined
  readonly put: (key: string, entry: Entry) => void
}

/** Сбой у поставщика модели, который не лечится повтором (вход истёк, нет средств): прогон останавливается. */
export class ProviderStop extends Error {}

/**
 * Что исправленный прогон (Amend) берёт из прежнего журнала: готовые ответы именованных актёров
 * (ключ содержит имя, порядковый номер и отпечаток задания). Безымянные и сбойные — заново.
 */
export function carried(entries: Iterable<readonly [string, Entry]>): (readonly [string, Entry])[] {
  return [...entries].filter(
    ([key, entry]) => key.startsWith("ask:") && !key.startsWith("ask:#") && entry.error === undefined,
  )
}

export type Outcome =
  | { readonly status: "completed"; readonly result: unknown }
  | { readonly status: "errored"; readonly error: string }
  | { readonly status: "stopped"; readonly reason: string; readonly error?: string }

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)
// Ошибка из песочницы — объект другого «мира»: instanceof Error для неё ложно.
const words = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : String(error)

export async function execute(input: {
  readonly compiled: Pick<WorkflowCompile.Compiled, "js" | "schemas">
  readonly args: Readonly<Record<string, unknown>>
  readonly host: Host
  readonly journal: Journal
  readonly signal?: AbortSignal
}): Promise<Outcome> {
  const { host, journal, compiled } = input
  const phase = new AsyncLocalStorage<string | undefined>()
  const counters = new Map<string, number>()
  const next = (key: string) => {
    const count = counters.get(key) ?? 0
    counters.set(key, count + 1)
    return `${key}:${count}`
  }
  const queues = new Map<string, Promise<unknown>>()
  const actors = new Map<string, ActorRef>()
  let halted = false
  let settle: (outcome: Outcome) => void = () => {}
  const stop = (outcome: Outcome) => {
    halted = true
    settle(outcome)
  }
  const stopped = new Promise<Outcome>((resolve) => (settle = resolve))
  const abort = () => stop({ status: "stopped", reason: String(input.signal?.reason ?? "user") })
  if (input.signal?.aborted) abort()
  input.signal?.addEventListener("abort", abort, { once: true })

  /** Записанное в журнал — из журнала, иначе выполнить и записать. */
  const journaled = async (key: string, run: () => Promise<unknown>, replayed?: () => void) => {
    // Остановленный прогон не начинает новых шагов: скрипт в песочнице ещё жив, но платить за него нельзя.
    if (input.signal?.aborted || halted) return new Promise(() => {})
    const entry = journal.get(key)
    if (entry) {
      replayed?.()
      if (entry.error !== undefined) throw new Error(entry.error)
      return entry.value
    }
    try {
      const value = await run()
      journal.put(key, { value })
      return value
    } catch (error) {
      if (error instanceof ProviderStop) {
        stop({ status: "stopped", reason: "provider", error: error.message })
        return new Promise(() => {})
      }
      journal.put(key, { error: words(error) })
      throw error
    }
  }
  const once = (key: string, run: () => void) => journaled(next(key), async () => run())

  const ask = (value: { key: string; instructions: string; schema: number | null }) => {
    const actor = actors.get(value.key) ?? { key: value.key }
    const schema = value.schema === null ? undefined : compiled.schemas[value.schema]
    const current = phase.getStore()
    const key = next(`ask:${actor.key}`) + ":" + hash(value.instructions + JSON.stringify(schema ?? null))
    const step = { actor, instructions: value.instructions, phase: current, key }
    const previous = queues.get(actor.key) ?? Promise.resolve()
    const turn = previous.then(
      () =>
        journaled(
          key,
          () => host.ask({ ...step, schema }),
          () => host.cached(step),
        ),
      () =>
        journaled(
          key,
          () => host.ask({ ...step, schema }),
          () => host.cached(step),
        ),
    )
    queues.set(
      actor.key,
      turn.catch(() => undefined),
    )
    return turn
  }

  const asynchronous: Record<string, (value: never) => Promise<unknown>> = {
    ask,
    observe: (value: { op: string; args: unknown[] }) =>
      journaled(next(`obs:${value.op}:${JSON.stringify(value.args)}`), () =>
        host.observe({ ...value, phase: phase.getStore() }),
      ),
    publish: (value: { kind: string; id: string; path?: string; content?: string; options?: unknown }) =>
      journaled(next(`artifact:${value.id}`), () => host.publish(value)),
  }
  const synchronous: Record<string, (value: never) => unknown> = {
    args: () => input.args,
    agent: (value: ActorRef) => {
      actors.set(value.key, value)
      host.actor(value)
    },
    log: (text: string) => void once("log", () => host.log(text)),
    report: (value: { item: unknown; tag?: string }) => void once("report", () => host.report(value.item, value.tag)),
    declare: (value: { kind: string; id: string; spec: unknown }) =>
      void once(`declare:${value.id}`, () => host.declare(value)),
    "phase.enter": (name: string) => {
      const previous = phase.getStore()
      phase.enterWith(name)
      return previous ?? null
    },
    "phase.exit": (previous: string | null) => phase.enterWith(previous ?? undefined),
  }

  const bridge = function (op: string, json: string, ok: (text?: string) => void, fail: (message: string) => void) {
    const value = JSON.parse(json) as never
    const sync = synchronous[op]
    if (sync) {
      const out = sync(value)
      return ok(out === undefined ? undefined : JSON.stringify(out))
    }
    const run = asynchronous[op]
    if (!run) return fail(`Unknown workflow operation: ${op}`)
    run(value).then(
      (out) => ok(out === undefined ? undefined : JSON.stringify(out)),
      (error: unknown) => fail(words(error)),
    )
  }
  Object.setPrototypeOf(bridge, null)

  const context = vm.createContext({ __bridge: bridge })
  const script = `${prelude}\n${compiled.js}\n__buff_workflow__()`
  const running = Promise.resolve()
    .then(() => vm.runInContext(script, context) as Promise<unknown>)
    .then(
      (result): Outcome => ({
        status: "completed",
        result: result === undefined ? null : JSON.parse(JSON.stringify(result)),
      }),
      (error: unknown): Outcome => ({ status: "errored", error: words(error) }),
    )
  try {
    return await Promise.race([running, stopped])
  } finally {
    input.signal?.removeEventListener("abort", abort)
  }
}
