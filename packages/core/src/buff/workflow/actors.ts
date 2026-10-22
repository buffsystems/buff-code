export * as WorkflowActors from "./actors.js"

import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { turnFailure, type TurnError } from "@opencode/schema/buff-turn-failure"
import { BuffLocale } from "../locale.js"
import { TokenUsage } from "@opencode/schema/token-usage"
import intro from "./prompts/actor-intro.md" with { type: "text" }
import roleText from "./prompts/actor-role.md" with { type: "text" }
import resultText from "./prompts/actor-result.md" with { type: "text" }
import remind from "./prompts/actor-remind.md" with { type: "text" }
import { WorkflowExecute } from "./execute.js"
import type { WorkflowSchemaOf } from "./schema-of.js"
import { WorkflowValidate } from "./validate.js"

/**
 * Актёры сценария (#448): каждый — сессия-субагент от сессии прогона. Первое задание идёт с
 * вводной и ролью, типизированное — с требованием сдать результат инструментом `workflow_result`
 * по схеме. Сбой поставщика модели останавливает прогон (скрипт его не видит). Каждый шаг
 * записан со статусом и метриками: токены, файлы, строки. Тексты — в `prompts/*.md`.
 */

export interface Sessions {
  readonly create: (input: { parent: string; title: string; metadata: Record<string, unknown> }) => Promise<string>
  readonly prompt: (input: { session: string; text: string }) => Promise<{ readonly message: string }>
  readonly wait: (session: string) => Promise<void>
  readonly state: (session: string) => Promise<{
    readonly outcome?: "succeeded" | "failed" | "interrupted"
    readonly error?: TurnError
    readonly tokens: TokenUsage.Info
    readonly providerID?: string
  }>
  readonly lastText: (session: string) => Promise<string>
  readonly diff: (input: { session: string; from: string }) => Promise<
    readonly {
      readonly status: "added" | "deleted" | "modified"
      readonly additions: number
      readonly deletions: number
    }[]
  >
}

export type StepRecord = BuffWorkflow.Step

export const render = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "")

const json = (text: string): { readonly value: unknown } | undefined => {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

/**
 * Ожидаемые результаты по сессиям актёров: инструмент сдаёт, шаг забирает. Модели часто шлют
 * объект строкой JSON — такая строка принимается, если прочитанное значение подходит к схеме.
 */
export function results() {
  const waiting = new Map<string, { schema: WorkflowSchemaOf.JsonSchema; value?: { readonly value: unknown } }>()
  return {
    expect: (session: string, schema: WorkflowSchemaOf.JsonSchema) => void waiting.set(session, { schema }),
    submit: (session: string, value: unknown): { readonly problems?: readonly string[] } => {
      const slot = waiting.get(session)
      if (!slot) return { problems: ["No result is expected from this session right now."] }
      const problems = WorkflowValidate.problems(value, slot.schema)
      const parsed = problems.length && typeof value === "string" ? json(value) : undefined
      if (parsed && !WorkflowValidate.problems(parsed.value, slot.schema).length) {
        slot.value = parsed
        return {}
      }
      if (problems.length) return { problems }
      slot.value = { value }
      return {}
    },
    take: (session: string) => {
      const value = waiting.get(session)?.value
      waiting.delete(session)
      return value
    },
  }
}
export type Results = ReturnType<typeof results>

const metricsOf = (
  before: TokenUsage.Info,
  after: TokenUsage.Info,
  files: Awaited<ReturnType<Sessions["diff"]>>,
): BuffWorkflow.Metrics => {
  const delta = (pick: (tokens: TokenUsage.Info) => number) => Math.max(0, pick(after) - pick(before))
  const count = (status: string) => files.filter((file) => file.status === status).length
  return {
    tokens: {
      input: delta((t) => t.input),
      output: delta((t) => t.output + t.reasoning),
      cache: delta((t) => t.cache.read + t.cache.write),
      total: delta(TokenUsage.total),
    },
    files: { added: count("added"), deleted: count("deleted"), modified: count("modified") },
    lines: {
      added: files.reduce((sum, file) => sum + file.additions, 0),
      deleted: files.reduce((sum, file) => sum + file.deletions, 0),
    },
  }
}

export function make(deps: {
  readonly run: { readonly id: string; readonly label: string; readonly root: string; readonly directory: string }
  readonly sessions: Sessions
  readonly results: Results
  readonly now: () => number
  readonly step: (step: StepRecord) => void
  /** Метрики идущего шага по ходу работы актёра (статус шага не трогает). */
  readonly progress?: (id: string, metrics: BuffWorkflow.Metrics) => void
  /** Как часто снимать метрики идущего шага, мс. */
  readonly tick?: number
}): WorkflowExecute.Host["ask"] {
  const tick = deps.tick ?? 3_000
  const opened = new Map<string, Promise<string>>()
  const open = (actor: WorkflowExecute.ActorRef) => {
    const existing = opened.get(actor.key)
    if (existing) return { session: existing, first: false }
    const session = deps.sessions.create({
      parent: deps.run.root,
      title: `${deps.run.label} · ${actor.name ?? actor.key}`,
      metadata: { buffWorkflow: { run: deps.run.id, actor: actor.key } },
    })
    opened.set(actor.key, session)
    return { session, first: true }
  }

  return async (input) => {
    const { session: pending, first } = open(input.actor)
    const session = await pending
    const started = deps.now()
    const base = {
      id: input.key,
      actor: input.actor.key,
      phase: input.phase,
      instructions: input.instructions,
      started,
    }
    deps.step({ ...base, status: "running", metrics: BuffWorkflow.EMPTY_METRICS })
    const before = (await deps.sessions.state(session)).tokens
    const lead = first
      ? render(intro, {
          run: deps.run.label,
          directory: deps.run.directory,
          name: input.actor.name ?? input.actor.key,
          role: input.actor.role ? render(roleText, { role: input.actor.role }) : "",
        }) + "\n"
      : ""
    const tail = input.schema ? render(resultText, { schema: JSON.stringify(input.schema, null, 2) }) : ""
    if (input.schema) deps.results.expect(session, input.schema)
    const spent = (tokens: TokenUsage.Info) => metricsOf(before, tokens, [])
    const watch = () =>
      setInterval(() => {
        void deps.sessions.state(session).then(
          (state) => deps.progress?.(base.id, spent(state.tokens)),
          () => undefined,
        )
      }, tick)
    const turn = async (text: string) => {
      const admitted = await deps.sessions.prompt({ session, text })
      const live = watch()
      await deps.sessions.wait(session).finally(() => clearInterval(live))
      const state = await deps.sessions.state(session)
      if (state.outcome === "failed" || state.outcome === "interrupted") {
        const words = state.error
          ? turnFailure(state.error, state.providerID ?? "", BuffLocale.t).text
          : "The actor session was interrupted."
        deps.step({
          ...base,
          status: "failed",
          error: words,
          finished: deps.now(),
          metrics: spent(state.tokens),
        })
        throw new WorkflowExecute.ProviderStop(words)
      }
      return admitted.message
    }
    const from = await turn(lead + input.instructions + tail)
    let value: unknown
    if (input.schema) {
      let submitted = deps.results.take(session)
      if (!submitted) {
        deps.results.expect(session, input.schema)
        await turn(remind.trim())
        submitted = deps.results.take(session)
      }
      if (!submitted) {
        const error = "The actor did not submit a result matching the schema."
        const state = await deps.sessions.state(session)
        deps.step({ ...base, status: "failed", error, finished: deps.now(), metrics: spent(state.tokens) })
        throw new Error(error)
      }
      value = submitted.value
    } else value = await deps.sessions.lastText(session)
    const after = (await deps.sessions.state(session)).tokens
    const metrics = metricsOf(before, after, await deps.sessions.diff({ session, from }))
    deps.step({ ...base, status: "done", result: value, finished: deps.now(), metrics })
    return value
  }
}
