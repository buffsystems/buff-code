import type { Prompt } from "@/composer/state"
import type { FileSelection } from "@/workspaces/files/model"

/**
 * «Добавить в чат» (#451): файл или его строки становятся упоминанием в конце поля ввода — так
 * же, как при перетаскивании файла. Упоминание видно человеку и уходит с сообщением.
 */
export function withMention(
  prompt: Prompt,
  file: { path: string; selection?: FileSelection },
): { prompt: Prompt; cursor: number; mention: string } {
  // Вложения (картинки) текста не несут и остаются на месте; пустой текст заменяется упоминанием.
  const text = (part: Prompt[number]) => ("content" in part ? part.content : "")
  const kept = prompt.filter((part) => !("content" in part) || part.content !== "")
  const typed = kept.map(text).join("")
  const gap = typed && !/\s$/.test(typed) ? " " : ""
  const selection = file.selection
  const lines = selection
    ? `:${selection.startLine}${selection.endLine === selection.startLine ? "" : `-${selection.endLine}`}`
    : ""
  const mention = `@${file.path}${lines}`
  const start = typed.length + gap.length
  const end = start + mention.length
  return {
    prompt: [
      ...kept,
      ...(gap ? [{ type: "text" as const, content: gap, start: typed.length, end: start }] : []),
      { type: "file" as const, path: file.path, content: mention, start, end, ...(selection ? { selection } : {}) },
      { type: "text" as const, content: " ", start: end, end: end + 1 },
    ],
    cursor: end + 1,
    mention,
  }
}
