export * as WorkflowLibrary from "./library.js"

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffLocale } from "../locale.js"
import { WorkflowCompile } from "./compile.js"

/**
 * Сохранённые сценарии (#448) — у пользователя, по решению владельца (в репозиторий не попадают):
 * `<каталог>/<имя>.dwf.ts`. Сохраняется только то, что компилируется; битые файлы перечисляются
 * с причиной, чтобы их можно было починить, а не исчезали молча.
 */

type Saved = { readonly meta: BuffWorkflowFile.Meta; readonly path: string }

export function make(root: string) {
  const file = (name: string) => path.join(root, name + BuffWorkflowFile.EXTENSION)
  const parse = async (target: string) => BuffWorkflowFile.parse(await readFile(target, "utf8"))
  const write = async (target: string, text: string) => {
    await mkdir(root, { recursive: true })
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, text)
    await rename(temp, target)
  }

  return {
    root,
    list: async () => {
      const names = await readdir(root).catch(() => [] as string[])
      const saved: Saved[] = []
      const invalid: { path: string; problem: string }[] = []
      for (const name of names.filter((item) => item.endsWith(BuffWorkflowFile.EXTENSION)).sort()) {
        const target = path.join(root, name)
        const parsed = await parse(target).catch((error: unknown) => ({
          problem: `The file cannot be read: ${String(error)}`,
        }))
        if ("problem" in parsed) invalid.push({ path: target, problem: parsed.problem })
        else saved.push({ meta: parsed.meta, path: target })
      }
      return { saved, invalid }
    },
    read: async (name: string) => {
      if (BuffWorkflowFile.nameProblem(name)) return undefined
      const target = file(name)
      const parsed = await parse(target).catch(() => undefined)
      return parsed && "meta" in parsed ? { ...parsed, path: target } : parsed
    },
    save: async (meta: BuffWorkflowFile.Meta, script: string, options: { readonly overwrite: boolean }) => {
      const bad = BuffWorkflowFile.nameProblem(meta.name)
      if (bad) return { problem: bad }
      const declared = BuffWorkflowFile.declarationProblems(meta.args, BuffLocale.t)
      if (declared.length) return { problem: declared.join(" ") }
      const compiled = WorkflowCompile.compile(script)
      if (!("js" in compiled)) return { diagnostics: compiled.diagnostics }
      const target = file(meta.name)
      const exists = await readFile(target).then(
        () => true,
        () => false,
      )
      if (exists && !options.overwrite) return { problem: `Workflow «${meta.name}» already exists: overwrite?` }
      await write(target, BuffWorkflowFile.serialize(meta, script))
      return { path: target, created: !exists }
    },
    /** Только метаданные; тело скрипта остаётся как есть. */
    saveMeta: async (name: string, meta: BuffWorkflowFile.Meta): Promise<{ readonly problem?: string }> => {
      const target = file(name)
      const parsed = await parse(target).catch(() => ({ problem: "The workflow no longer exists." }))
      if ("problem" in parsed) return { problem: parsed.problem }
      if (!meta.description.trim()) return { problem: "The workflow has no description." }
      const declared = BuffWorkflowFile.declarationProblems(meta.args, BuffLocale.t)
      if (declared.length) return { problem: declared.join(" ") }
      await write(target, BuffWorkflowFile.serialize({ ...meta, name }, parsed.script))
      return {}
    },
    remove: async (name: string) => {
      if (BuffWorkflowFile.nameProblem(name)) return false
      return rm(file(name)).then(
        () => true,
        () => false,
      )
    },
  }
}

export type Library = ReturnType<typeof make>
