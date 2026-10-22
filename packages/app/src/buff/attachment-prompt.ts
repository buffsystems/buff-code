import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import { appendPrompt, isAttachment, promptLength } from "@/composer/prompt-parts"
import type { BuffTextAttachmentPart, Prompt } from "@/composer/state"

/**
 * Чипы вставленного текста и цитаты в черновике (#459): как сделать чип и как развернуть его
 * обратно в текст поля. Цитата разворачивается цитатой — тем, что получила бы модель.
 */

export function chipPart(kind: BuffTextAttachmentPart["kind"], text: string, id: string): BuffTextAttachmentPart {
  return { type: "buff-text", id, kind, text }
}

export function expandChip(prompt: Prompt, id: string): Prompt {
  const chip = prompt.find((part): part is BuffTextAttachmentPart => part.type === "buff-text" && part.id === id)
  if (!chip) return prompt
  const content = chip.kind === "quote" ? BuffComposerParts.quoteBlock(chip.text) : chip.text
  const rest = prompt.filter((part) => part !== chip)
  const insert = { type: "text" as const, content, start: 0, end: content.length }
  if (promptLength(rest) === 0) return [...rest.filter(isAttachment), insert]
  return appendPrompt(rest, [insert])
}
