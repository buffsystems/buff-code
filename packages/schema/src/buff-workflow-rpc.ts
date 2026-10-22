export * as BuffWorkflowRpc from "./buff-workflow-rpc.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffWorkflow } from "./buff-workflow.js"
import { BuffWorkflowFile } from "./buff-workflow-file.js"

/**
 * Сценарии в окне и консоли (#448): список сохранённых, детали и правка метаданных (сам скрипт
 * — только чтение, правит модель в чате), запуск с аргументами, прогоны и их ход, остановка,
 * продолжение, ответ на вопрос актёра. Хранит и исполняет ядро (`core/src/buff/workflow*`).
 */

const portable = Schema.toStandardSchemaV1

export const Saved = Schema.Struct({
  meta: BuffWorkflowFile.Meta,
  path: Schema.String,
  last: Schema.optional(Schema.Struct({ status: BuffWorkflow.RunStatus, updated: Schema.Number, id: Schema.String })),
})
export type Saved = typeof Saved.Type
export const Invalid = Schema.Struct({ path: Schema.String, problem: Schema.String })

export const Detail = Schema.Struct({
  run: BuffWorkflow.Run,
  actors: Schema.Array(BuffWorkflow.Actor),
  steps: Schema.Array(BuffWorkflow.Step),
  questions: Schema.Array(BuffWorkflow.Question),
  artifacts: Schema.Array(BuffWorkflow.Artifact),
  /** Что прогон опубликовал через report(): по порядку, с тегом панели, если он есть. */
  items: Schema.Array(Schema.Struct({ value: Schema.Unknown, artifact: Schema.optional(Schema.String) })),
  log: Schema.Array(Schema.Struct({ at: Schema.Number, text: Schema.String })),
})
export type Detail = typeof Detail.Type

const Name = Schema.Struct({ name: Schema.String })
const Id = Schema.Struct({ id: Schema.String })
const Done = Schema.Struct({ problem: Schema.optional(Schema.String) })

export const Rpc = define({
  id: "buff.workflow",
  methods: {
    list: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Struct({ saved: Schema.Array(Saved), invalid: Schema.Array(Invalid) })),
    },
    read: {
      input: portable(Name),
      output: portable(Schema.Struct({ meta: BuffWorkflowFile.Meta, script: Schema.String, path: Schema.String })),
    },
    /** Только метаданные — описание, «когда применять», аргументы; тело скрипта не меняется. */
    saveMeta: {
      input: portable(Schema.Struct({ name: Schema.String, meta: BuffWorkflowFile.Meta })),
      output: portable(Done),
    },
    remove: { input: portable(Name), output: portable(Schema.Struct({ removed: Schema.Boolean })) },
    /** Запустить сохранённый сценарий в новой сессии проекта. */
    start: {
      input: portable(
        Schema.Struct({
          name: Schema.String,
          args: Schema.Record(Schema.String, Schema.Unknown),
          directory: Schema.String,
        }),
      ),
      output: portable(
        Schema.Struct({
          run: Schema.optional(Schema.String),
          session: Schema.optional(Schema.String),
          problem: Schema.optional(Schema.String),
          problems: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
    },
    runs: {
      input: portable(Schema.Struct({ workflow: Schema.optional(Schema.String) })),
      output: portable(Schema.Struct({ runs: Schema.Array(BuffWorkflow.Run) })),
    },
    run: { input: portable(Id), output: portable(Detail) },
    stop: { input: portable(Id), output: portable(Schema.Struct({ stopped: Schema.Boolean })) },
    resume: { input: portable(Id), output: portable(Done) },
    answer: {
      input: portable(Schema.Struct({ question: Schema.String, text: Schema.String })),
      output: portable(Done),
    },
  },
  events: {},
})
