import { BuffLinks } from "@opencode/schema/buff-links"
import { t } from "./locale"

/**
 * Отчёт о сбое консоли (#462). Апстрим складывал его в ссылку на свой трекер; у нас это текст,
 * который человек копирует с экрана сбоя и отправляет в поддержку.
 */
export const CRASH_SUPPORT = BuffLinks.supportAddress

export function crashReport(input: {
  message: string
  stack: string
  version: string
  os: string
  terminal: string
}): string {
  return [
    t("Buff Code {version} — the console app crashed", { version: input.version }),
    t("System: {os}", { os: input.os }),
    t("Terminal: {terminal}", { terminal: input.terminal }),
    "",
    t("Error: {message}", { message: input.message }),
    "",
    input.stack,
    "",
    t("Send this report to {support} and describe what you were doing before the crash.", { support: CRASH_SUPPORT }),
  ].join("\n")
}
