import type { BuffGit } from "@opencode/schema/buff-git"
import TEMPLATE from "./prompts/commit-message.md" with { type: "text" }
import { BuffLocale } from "./locale.js"

/**
 * Просьба к модели сочинить сообщение коммита (#454). Текст просьбы — в шаблоне
 * `prompts/commit-message.md`; код только подставляет список файлов и изменения.
 */

// Язык по умолчанию — язык человека (#472): просьба к модели по-английски, коммит — на его языке.
const LANGUAGE = { ru: "Russian", en: "English" } as const

export function commitPrompt(input: { recent: string; files: string; diff: string }): string {
  return TEMPLATE.replace("{{language}}", LANGUAGE[BuffLocale.current()])
    .replace("{{recent}}", input.recent.trim() || "(none)")
    .replace("{{files}}", input.files.trim())
    .replace("{{diff}}", input.diff.trim() || "(only new files — see the list)")
}

/** Модели иногда оборачивают ответ в кавычки или блок кода — снимаем обёртку. */
export function commitMessage(answer: string): string {
  return answer
    .trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .replace(/^["«']([\s\S]*)["»']$/, "$1")
    .trim()
}

/**
 * Новые файлы, которых нет в `git diff HEAD` (git их ещё не знает): их показываем целиком, иначе
 * модель тянется прочитать их инструментом и не отвечает текстом (#470).
 */
export function newFilesMissingFromDiff(changes: readonly BuffGit.Change[], diff: string): string[] {
  return changes
    .filter((change) => change.status === "added" && !diff.includes(`diff --git a/${change.file} b/${change.file}`))
    .map((change) => change.file)
}
