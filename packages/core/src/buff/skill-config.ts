export * as BuffSkillConfig from "./skill-config.js"

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { BuffLocale } from "./locale.js"

/**
 * Подключённые источники навыков в файле конфигурации (#445): настройка `skills` — каталоги и
 * адреса, откуда ядро берёт навыки помимо своих каталогов. Текст на входе, текст на выходе;
 * остальное в файле не трогается.
 */
const FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }
const BROKEN = "The configuration file cannot be read: it has a markup error. Fix it by hand."

export function sources(text: string): string[] {
  if (!text.trim()) return []
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof parsed !== "object" || parsed === null) throw new Error(BuffLocale.t(BROKEN))
  const skills = (parsed as { skills?: unknown }).skills
  return Array.isArray(skills) ? skills.filter((item): item is string => typeof item === "string") : []
}

/** Подключить источник (`attached: false` — отключить). */
export function withSource(text: string, source: string, attached: boolean): string {
  const current = sources(text)
  const next = attached
    ? current.includes(source)
      ? current
      : [...current, source]
    : current.filter((item) => item !== source)
  if (next.length === current.length) return text
  const base = text.trim() ? text : "{}\n"
  const edited = applyEdits(base, modify(base, ["skills"], next, FORMAT))
  return edited.endsWith("\n") ? edited : `${edited}\n`
}
