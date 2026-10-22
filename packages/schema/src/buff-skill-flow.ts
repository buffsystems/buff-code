export * as BuffSkillFlow from "./buff-skill-flow.js"

import { BuffI18n } from "./buff-i18n.js"
import { tr, type Ui } from "./buff-mcp-flow.js"
import { BuffSkill } from "./buff-skill.js"

/**
 * Навыки в консоли (#445): строки списка /skills — с происхождением и состоянием — и шаги
 * подключения каталога с навыками. Диалоги приходят снаружи, так что шаги проверяются без
 * терминала. `undefined` — человек вышел из вопроса; `problem` — ответ не годится.
 */

export type Problem = { readonly problem: string }

export interface Row {
  readonly id: string
  readonly title: string
  readonly description?: string
  /** Откуда навык и выключен ли он. */
  readonly status: string
  readonly enabled: boolean
}

export function rows(entries: readonly BuffSkill.Entry[], t: BuffI18n.T = BuffI18n.english): Row[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.name,
    description: entry.description?.replace(/\s+/g, " ").trim(),
    status: BuffSkill.scopeLabel(entry.scope, t) + (entry.enabled ? "" : ` · ${t("disabled")}`),
    enabled: entry.enabled,
  }))
}

export function toggleTitle(enabled: boolean | undefined, t: BuffI18n.T = BuffI18n.english): string {
  return t(enabled ? "turn off" : "turn on")
}

/** Подсказка в списке навыков: чем подключают и отключают каталоги. */
export const COMMANDS_HINT = "/skill-attach · /skill-detach"

const where = (scope: BuffSkill.Scope, t: BuffI18n.T) => t(scope === "project" ? "in the project" : "on my machine")

export async function attach(ui: Ui): Promise<BuffSkill.Source | Problem | undefined> {
  const t = tr(ui)
  const scope = await ui.select<BuffSkill.Scope>({
    title: t("Whom to attach the skills for"),
    options: [
      { title: t("For me — in all projects"), value: "user", description: t("the entry stays on this machine") },
      { title: t("For this project"), value: "project", description: t("the entry goes to the repository") },
    ],
  })
  if (!scope) return
  const source = await ui.prompt({
    title: t("Directory or address with skills"),
    description: t(
      "A directory on this machine (with folders holding a SKILL.md file) or an address where the skills are published.",
    ),
    placeholder: "~/team-skills",
  })
  if (source === undefined) return
  const problem = BuffSkill.sourceProblem(source, t)
  return problem ? { problem } : { scope, source: source.trim() }
}

export async function detach(
  ui: Ui,
  sources: readonly BuffSkill.Source[],
): Promise<BuffSkill.Source | Problem | undefined> {
  const t = tr(ui)
  if (!sources.length) return { problem: t("No directories attached. To attach one — /skill-attach.") }
  const index = await ui.select<number>({
    title: t("What to detach"),
    options: sources.map((source, value) => ({ title: source.source, value, description: where(source.scope, t) })),
  })
  return index === undefined ? undefined : sources[index]
}
