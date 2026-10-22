export * as WorkflowPolicy from "./policy.js"

import path from "node:path"
import type { Permission } from "@opencode/schema/permission"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"

/**
 * Разрешения сценариев (#448): запуск и сохранение человек подтверждает всегда («разрешить всё»
 * их не пропускает); черновики скриптов — файлы службы, их правка ничего не спрашивает (как в
 * ZCode); сессии актёров не запускают своих сценариев, но сдают результат и задают вопросы.
 */

/** Право на инструменты, которые запускают и ведут сценарии. */
export const ORCHESTRATE = "workflow"
/** Право на инструменты актёра: сдать результат, задать вопрос. */
export const ACTOR = "workflow_actor"

type Event = { readonly action: string; readonly resources: readonly string[]; readonly effect: Permission.Effect }

export function make(drafts: string) {
  const root = path.resolve(drafts)
  const inside = (resource: string) => {
    const target = path.resolve(resource.endsWith("/*") ? resource.slice(0, -2) : resource)
    return target === root || target.startsWith(root + path.sep)
  }
  return {
    effect: (event: Event): Permission.Effect => {
      if (event.action === BuffWorkflow.PERMISSION_ACTION) return event.effect === "allow" ? "ask" : event.effect
      const draft = (event.action === "edit" || event.action === "external_directory") && event.resources.every(inside)
      return draft && event.effect === "ask" ? "allow" : event.effect
    },
  }
}

export function actorRules(parent: Permission.Ruleset): Permission.Ruleset {
  return [
    ...parent,
    { action: ORCHESTRATE, resource: "*", effect: "deny" },
    { action: ACTOR, resource: "*", effect: "allow" },
  ]
}
