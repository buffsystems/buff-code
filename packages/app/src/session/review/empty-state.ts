import type { ChangeMode } from "./model"

/**
 * Что показывает ревью, когда изменений нет (Buff, #467). Без git изменения не появятся ни в
 * каком режиме, поэтому «нет git» идёт раньше загрузки: запрос изменений в таком проекте не
 * отправляется вовсе, и ждать его ответа можно вечно.
 */
export type ReviewEmptyState = "no-git" | "loading" | "empty"

export function reviewEmptyState(input: { mode: ChangeMode; ready: boolean; noGit: boolean }): ReviewEmptyState {
  if (input.noGit) return "no-git"
  if ((input.mode === "git" || input.mode === "branch") && !input.ready) return "loading"
  return "empty"
}

/** Дочитаны ли изменения. Без git читать нечего — ждать тоже нечего. */
export function reviewReady(input: { mode: ChangeMode; pending: boolean; noGit: boolean }): boolean {
  if (input.noGit) return true
  if (input.mode === "git" || input.mode === "branch") return !input.pending
  return true
}
