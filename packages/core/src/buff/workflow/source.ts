export * as WorkflowSource from "./source.js"

import path from "node:path"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"

/**
 * Откуда инструмент берёт скрипт сценария (#448), как в ZCode: текстом — сначала в черновик,
 * чтобы диагностика указывала на файл и модель правила его, а не присылала скрипт заново;
 * файлом — только из проекта или черновиков; сохранённый — с проверенными аргументами и копией
 * в черновик, чтобы правка не задела сохранённый файл.
 */

export const ONE = "Pass exactly one source: script, path or saved."

type Saved = { readonly meta: BuffWorkflowFile.Meta; readonly script: string; readonly path: string }

export interface Deps {
  readonly directory: string
  readonly drafts: string
  readonly draft: (text: string) => Promise<string>
  readonly read: (file: string) => Promise<string | undefined>
  readonly saved: (name: string) => Promise<Saved | { readonly problem: string } | undefined>
}

export interface Input {
  readonly script?: string
  readonly path?: string
  readonly saved?: { readonly name: string; readonly args?: Readonly<Record<string, unknown>> }
}

export type Source =
  | {
      readonly text: string
      readonly path: string
      readonly args?: Readonly<Record<string, unknown>>
      readonly workflow?: string
    }
  | { readonly problem: string }

const within = (root: string, target: string) => {
  const relative = path.relative(path.resolve(root), target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export async function resolve(input: Input, deps: Deps): Promise<Source> {
  const given = [input.script, input.path, input.saved].filter((item) => item !== undefined)
  if (given.length !== 1) return { problem: ONE }
  if (input.script !== undefined) return { text: input.script, path: await deps.draft(input.script) }
  if (input.path !== undefined) {
    const target = path.resolve(deps.directory, input.path)
    if (!within(deps.directory, target) && !within(deps.drafts, target))
      return { problem: `${target}: a workflow script must be in this project or a workflow draft.` }
    const text = await deps.read(target)
    return text === undefined ? { problem: `${target}: no such file.` } : { text, path: target }
  }
  const name = input.saved!.name
  const saved = await deps.saved(name)
  if (!saved) return { problem: `No saved workflow "${name}"; see workflow_saved.` }
  if ("problem" in saved) return { problem: saved.problem }
  const checked = BuffWorkflowFile.checkArgs(saved.meta.args, input.saved!.args ?? {})
  if ("problems" in checked)
    return {
      problem: Object.entries(checked.problems)
        .map(([arg, problem]) => `${arg}: ${problem}`)
        .join("\n"),
    }
  return { text: saved.script, path: await deps.draft(saved.script), args: checked.values, workflow: name }
}
