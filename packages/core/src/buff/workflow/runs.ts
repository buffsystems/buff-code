export * as WorkflowRuns from "./runs.js"

import { Effect, Option, Schema } from "effect"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import type { KV } from "../../kv.js"
import type { WorkflowExecute } from "./execute.js"

/**
 * Прогоны сценариев (#448) в KV службы: прогон, его журнал, актёры, шаги, вопросы, артефакты,
 * опубликованное и лог — каждое своей записью, история не переписывается целиком и переживает
 * перезапуск. Порядок записей — по ключу (номера дополнены нулями).
 */

export type Storage = Pick<KV.Interface, "get" | "set" | "scan">

const json = (value: unknown) => value as KV.Value
const order = (n: number) => String(n).padStart(9, "0")
const decode = <A>(schema: Schema.Codec<A, unknown>) =>
  Schema.decodeUnknownOption(schema as Schema.Codec<A, unknown, never, never>)
const Item = Schema.Struct({ value: Schema.Unknown, artifact: Schema.optional(Schema.String) })
const Line = Schema.Struct({ at: Schema.Number, text: Schema.String })

export function make(storage: Storage) {
  const scan = (prefix: string): Effect.Effect<readonly KV.Entry[]> => {
    const page = (after: string | undefined): Effect.Effect<readonly KV.Entry[]> =>
      storage
        .scan({ prefix, after })
        .pipe(
          Effect.flatMap((result) =>
            result.next === undefined
              ? Effect.succeed(result.entries)
              : page(result.next).pipe(Effect.map((rest) => [...result.entries, ...rest])),
          ),
        )
    return page(undefined)
  }
  const all = <A>(prefix: string, schema: Schema.Codec<A, unknown>) =>
    scan(prefix).pipe(Effect.map((entries) => entries.flatMap((entry) => Option.toArray(decode(schema)(entry.value)))))
  const counted = new Map<string, number>()
  const append = (prefix: string, value: unknown) =>
    Effect.gen(function* () {
      const known = counted.get(prefix) ?? (yield* scan(prefix)).length
      counted.set(prefix, known + 1)
      yield* storage.set(prefix + order(known), json(value))
    })

  return {
    putRun: (run: BuffWorkflow.Run) => storage.set(`run:${run.id}`, json(run)),
    getRun: (id: string) =>
      storage.get(`run:${id}`).pipe(Effect.map((value) => Option.getOrUndefined(decode(BuffWorkflow.Run)(value)))),
    runs: (workflow?: string) =>
      all("run:", BuffWorkflow.Run).pipe(
        Effect.map((runs) =>
          runs
            .filter((run) => workflow === undefined || run.workflow === workflow)
            .toSorted((a, b) => b.updated - a.updated),
        ),
      ),
    putEntry: (run: string, key: string, entry: WorkflowExecute.Entry) => storage.set(`j:${run}:${key}`, json(entry)),
    journal: (run: string) =>
      scan(`j:${run}:`).pipe(
        Effect.map(
          (entries) =>
            new Map(
              entries.map((entry) => [entry.key.slice(`j:${run}:`.length), entry.value as WorkflowExecute.Entry]),
            ),
        ),
      ),
    putActor: (run: string, actor: BuffWorkflow.Actor) => storage.set(`actor:${run}:${actor.key}`, json(actor)),
    putStep: (run: string, step: BuffWorkflow.Step) => storage.set(`step:${run}:${step.id}`, json(step)),
    putQuestion: (run: string, question: BuffWorkflow.Question) =>
      storage.set(`q:${run}:${question.id}`, json(question)),
    putArtifact: (run: string, artifact: BuffWorkflow.Artifact) =>
      storage.set(`art:${run}:${artifact.id}`, json(artifact)),
    addItem: (run: string, item: { readonly value: unknown; readonly artifact?: string }) =>
      append(`item:${run}:`, item),
    addLog: (run: string, line: { readonly at: number; readonly text: string }) => append(`log:${run}:`, line),
    detail: (id: string): Effect.Effect<BuffWorkflowRpc.Detail | undefined> =>
      Effect.gen(function* () {
        const run = Option.getOrUndefined(decode(BuffWorkflow.Run)(yield* storage.get(`run:${id}`)))
        if (!run) return undefined
        return {
          run,
          actors: yield* all(`actor:${id}:`, BuffWorkflow.Actor),
          steps: (yield* all(`step:${id}:`, BuffWorkflow.Step)).toSorted((a, b) => a.started - b.started),
          questions: yield* all(`q:${id}:`, BuffWorkflow.Question),
          artifacts: yield* all(`art:${id}:`, BuffWorkflow.Artifact),
          items: yield* all(`item:${id}:`, Item),
          log: yield* all(`log:${id}:`, Line),
        }
      }),
  }
}

export type Runs = ReturnType<typeof make>
