export * as WorkflowNotify from "./notify.js"

import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import doneText from "./prompts/run-done.md" with { type: "text" }
import questionText from "./prompts/run-question.md" with { type: "text" }
import { WorkflowActors } from "./actors.js"
import { BuffLocale } from "../locale.js"

/**
 * Что получает сессия, из которой запущен сценарий (#448): итог прогона — статус словами,
 * результат, всё опубликованное через report() (даже при сбое) и артефакты по названиям;
 * вопрос актёра — кто спрашивает, что и как ответить. Тексты — в `prompts/*.md`.
 */

export function done(
  run: BuffWorkflow.Run,
  items: readonly { readonly value: unknown; readonly artifact?: string }[],
  artifacts: readonly BuffWorkflow.Artifact[],
): string {
  const result =
    run.result === undefined ? "" : `Result:\n\`\`\`json\n${JSON.stringify(run.result, null, 2)}\n\`\`\`\n\n`
  const reported = items.filter((item) => !item.artifact)
  const list = reported.length
    ? `Reported items:\n${reported.map((item) => `- ${JSON.stringify(item.value)}`).join("\n")}\n\n`
    : ""
  const cards = artifacts.length
    ? `Artifacts:\n${artifacts.map((item) => `- ${item.title ?? item.id} (${item.kind}${item.primary ? ", primary" : ""})`).join("\n")}\n\n`
    : ""
  return WorkflowActors.render(doneText, {
    label: run.label,
    id: run.id,
    status: BuffWorkflow.runLabel(run),
    result,
    items: list,
    artifacts: cards,
    script: run.scriptPath ? `Script file: ${run.scriptPath}\n\n` : "",
  })
}

export function question(run: BuffWorkflow.Run, asked: BuffWorkflow.Question): string {
  return WorkflowActors.render(questionText, {
    actor: asked.actor,
    label: run.label,
    run: run.id,
    text: asked.text,
    id: asked.id,
  })
}

/** Что видит человек рядом с отметкой «Сценарий» (#711): конец прогона словами. */
export function doneSummary(run: BuffWorkflow.Run): string {
  if (run.status === "errored") return BuffLocale.t("«{label}» — error", { label: run.label })
  if (run.status === "stopped") return BuffLocale.t("«{label}» stopped", { label: run.label })
  return BuffLocale.t("«{label}» finished", { label: run.label })
}

/** …и вопрос актёра как он задан. */
export function questionSummary(asked: BuffWorkflow.Question): string {
  return `${asked.actor}: ${asked.text}`
}
