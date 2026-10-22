export * as WorkflowCompile from "./compile.js"

import ts from "typescript"
import { WorkflowAnalyze } from "./analyze.js"
import { WorkflowProgram } from "./program.js"
import { WorkflowSchemaOf } from "./schema-of.js"

/**
 * Компиляция сценария (#448): проверка типов по фасаду и правила анализатора; при успехе —
 * исполняемый JS (тело — асинхронная функция `__buff_workflow__`), фазы, команды, имена актёров,
 * объявленные артефакты и схемы результатов `ask<T>` по порядку.
 */

export interface Compiled {
  readonly diagnostics: readonly WorkflowProgram.Diagnostic[]
  readonly js: string
  readonly phases: readonly string[]
  readonly commands: readonly string[]
  readonly actors: readonly string[]
  readonly artifacts: readonly { readonly id: string; readonly kind: string }[]
  readonly schemas: readonly WorkflowSchemaOf.JsonSchema[]
}

export type Result = Compiled | { readonly diagnostics: readonly WorkflowProgram.Diagnostic[] }

const apply = (text: string, edits: readonly WorkflowAnalyze.Edit[]) =>
  edits
    .toSorted((a, b) => b.at - a.at || b.end - a.end)
    .reduce((out, edit) => out.slice(0, edit.at) + edit.text + out.slice(edit.end), text)

/** `snippet` — пробный кусочек (Eval): без фаз, без агентов и report — только наблюдения и логика. */
export function compile(script: string, options: { readonly snippet?: boolean } = {}): Result {
  const { program, source, checker } = WorkflowProgram.create(script)
  const analysis = WorkflowAnalyze.analyze(source, options)
  const diagnostics = [...WorkflowProgram.diagnostics(program, source), ...analysis.problems].toSorted(
    (a, b) => a.line - b.line || a.column - b.column,
  )
  if (diagnostics.length) return { diagnostics }
  const schemas = analysis.asks.map(({ type }) => WorkflowSchemaOf.schemaOf(checker.getTypeFromTypeNode(type), checker))
  const js = ts.transpileModule(apply(source.text, analysis.edits), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText
  return {
    diagnostics: [],
    js,
    phases: analysis.phases,
    commands: analysis.commands,
    actors: analysis.actors,
    artifacts: analysis.artifacts,
    schemas,
  }
}
