import type { FormAnswer, FormInfo, FormValue } from "@opencode/client/promise"

/**
 * Формы, которые просят MCP-серверы (#470): запись в базу знаний ждёт «Добавить эту запись?».
 * Сервер не знает сессии, поэтому форма приходит общей для каталога (`global`). Окно показывало
 * только вопросы агента — вызов висел без ответа. Здесь: какую форму показать, значения полей
 * по умолчанию, ответ серверу и что не так с заполнением.
 */

type Field = FormInfo["fields"][number]
export type Values = Record<string, unknown>
type T = (text: string, params?: Record<string, string | number>) => string

export function mcpForm(forms: readonly FormInfo[] | undefined): FormInfo | undefined {
  return forms?.find((form) => form.metadata?.kind === "mcp-elicitation")
}

/** Форма режима «Настройка» (#765): агент спрашивает адреса, логины, секреты — у своей сессии. */
export function setupForm(forms: readonly FormInfo[] | undefined): FormInfo | undefined {
  return forms?.find((form) => form.metadata?.kind === "setup")
}

export const isSetupForm = (form: FormInfo): boolean => form.metadata?.kind === "setup"

/** Свои варианты человека к полям с `custom` (#765): у выбора одного — один, у нескольких — список. */
export type Own = Record<string, readonly string[]>

const trimmed = (list: readonly string[] | undefined) => [
  ...new Set((list ?? []).map((item) => item.trim()).filter(Boolean)),
]

/** Значения с учётом своих вариантов: свой ответ побеждает выбор, свои пункты добавляются к выбранным. */
export function withOwn(fields: readonly Field[], values: Values, own: Own): Values {
  return Object.fromEntries(
    fields.map((field) => {
      const mine = trimmed(own[field.key])
      if (field.type === "string" && field.custom && mine.length) return [field.key, mine[0]]
      if (field.type === "multiselect" && field.custom && mine.length) {
        const picked = Array.isArray(values[field.key]) ? (values[field.key] as string[]) : []
        return [field.key, [...new Set([...picked, ...mine])]]
      }
      return [field.key, values[field.key]]
    }),
  )
}

export function formDefaults(fields: readonly Field[]): Values {
  return Object.fromEntries(
    fields.map((field) => {
      if (field.type === "boolean") return [field.key, field.default ?? false]
      if (field.type === "multiselect") return [field.key, field.default ?? []]
      if (field.type === "string") return [field.key, field.default ?? ""]
      if (field.type === "secret") return [field.key, ""]
      if (field.type === "number" || field.type === "integer")
        return [field.key, field.default === undefined ? "" : String(field.default)]
      return [field.key, undefined]
    }),
  )
}

const blank = (value: unknown) =>
  value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length)

export type FieldView = "yes-no" | "switch" | "choice" | "multi" | "text" | "secret" | "link"

/** Как показать поле. Единственный флажок («Добавить эту запись?») — вопрос с ответом кнопкой. */
export function fieldView(field: Field, fields: readonly Field[]): FieldView {
  if (field.type === "external") return "link"
  // Секрет (#765): ввод с маской, значение никогда не показывается обратно.
  if (field.type === "secret") return "secret"
  if (field.type === "boolean") return fields.length === 1 ? "yes-no" : "switch"
  if (field.type === "multiselect") return "multi"
  if (field.type === "string" && field.options?.length) return "choice"
  return "text"
}

export function hiddenField(field: Field): boolean {
  return field.type !== "external" && field.hidden === true
}

export function formAnswer(fields: readonly Field[], values: Values): FormAnswer {
  return Object.fromEntries(
    fields.flatMap((field): [string, FormValue][] => {
      if (field.type === "external") return values[field.key] === true ? [[field.key, true]] : []
      if (field.hidden) return []
      const value = values[field.key]
      if (field.type === "boolean") return [[field.key, value === true]]
      if (blank(value)) return []
      if (field.type === "number" || field.type === "integer") return [[field.key, Number(value)]]
      return [[field.key, value as FormValue]]
    }),
  )
}

export function formProblem(fields: readonly Field[], values: Values, t: T): string | undefined {
  if (fields.some((field) => field.type === "external" && values[field.key] !== true)) return t("Open the page first.")
  const missing = fields.find(
    (field) =>
      field.type !== "external" &&
      field.required &&
      !field.hidden &&
      field.type !== "boolean" &&
      blank(values[field.key]),
  )
  return missing ? t("Fill in «{field}».", { field: missing.title ?? missing.key }) : undefined
}
