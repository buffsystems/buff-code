import { confirm, log, multiselect, password, select, text, type Option } from "@clack/prompts"
import { Effect, Schema } from "effect"
import { Form } from "@opencode/schema/form"
import { formValidateValue } from "@opencode/tui/util/form"
import type { FormAnswer, FormField, FormFields } from "@opencode/client"
import { t } from "../../../buff/locale"
import { openUrl, prompt, requireInteractive } from "../../../ui/prompt"

const skip = Symbol("skip")
const custom = Symbol("custom")
const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(Form.Value))

export const answerForm = Effect.fn("cli.auth.form")(function* (
  fields: FormFields | undefined,
  input: ReadonlyArray<string> = [],
) {
  const supplied = new Map<string, string>()
  for (const item of input) {
    const separator = item.indexOf("=")
    if (separator < 1) return yield* Effect.fail(new Error(t("Expected --answer key=value")))
    const key = item.slice(0, separator)
    if (!fields?.some((field) => field.key === key)) {
      return yield* Effect.fail(new Error(t("Unknown form field: {key}", { key })))
    }
    supplied.set(key, item.slice(separator + 1))
  }
  if (!fields) return undefined
  const answer: FormAnswer = {}
  for (const field of fields) {
    if (!active(field, answer)) {
      if (supplied.has(field.key)) {
        return yield* Effect.fail(new Error(t("Form field is not active: {key}", { key: field.key })))
      }
      continue
    }
    const provided = supplied.get(field.key)
    const value =
      provided !== undefined
        ? yield* suppliedAnswer(field, provided)
        : field.type !== "external" && field.hidden
          ? field.default
          : yield* answerField(field)
    if (field.type !== "external") {
      const invalid = formValidateValue(field, value)
      if (invalid) return yield* Effect.fail(new Error(`${field.key}: ${invalid}`))
    }
    if (value !== undefined) answer[field.key] = value
  }
  return answer
})

const suppliedAnswer = Effect.fn("cli.auth.form.answer")(function* (field: FormField, input: string) {
  if (field.type === "external") {
    return yield* Effect.fail(
      new Error(t("External form field requires interactive confirmation: {key}", { key: field.key })),
    )
  }
  if (field.type === "string") return input
  const value = decodeAnswer(input)
  if (value._tag === "None") {
    return yield* Effect.fail(new Error(t("Expected a JSON value for form field: {key}", { key: field.key })))
  }
  return typeof value.value === "object" ? [...value.value] : value.value
})

export const secret = Effect.fn("cli.auth.secret")(function* (message: string) {
  yield* requireInteractive(t("API key input requires an interactive terminal"))
  return yield* prompt<string>(() => password({ message, validate: required }))
})

const answerField = Effect.fn("cli.auth.form.field")(function* (field: FormField) {
  yield* requireInteractive(t("Authentication form input requires an interactive terminal"))
  const message = field.title ?? field.key
  if (field.description) log.info(field.description)
  if (field.type === "external") {
    log.info(field.url)
    yield* openUrl(field.url)
    const acknowledged = yield* prompt<boolean>(() =>
      confirm({ message: message || t("Continue after completing this step?"), initialValue: true }),
    )
    if (!acknowledged)
      return yield* Effect.fail(new Error(t("{step} is required", { step: message || t("External step") })))
    return true
  }
  if (field.type === "boolean") {
    if (field.required) return yield* prompt<boolean>(() => confirm({ message, initialValue: field.default ?? true }))
    const options: Array<Option<boolean | typeof skip>> = [
      { value: true, label: t("Yes") },
      { value: false, label: t("No") },
      { value: skip, label: t("Skip") },
    ]
    const value = yield* prompt<boolean | typeof skip>(() =>
      select<boolean | typeof skip>({
        message,
        options,
        initialValue: field.default ?? skip,
      }),
    )
    if (value === skip) return undefined
    return value
  }
  if (field.type === "multiselect") {
    const options: Array<Option<string | typeof custom>> = field.options.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.description,
    }))
    if (field.custom) options.push({ value: custom, label: t("Type another value") })
    const values = yield* prompt<Array<string | typeof custom>>(() =>
      multiselect<string | typeof custom>({
        message,
        options,
        initialValues: field.default,
        required: field.required || (field.minItems ?? 0) > 0,
      }),
    )
    const selected = values.filter((value): value is string => value !== custom)
    if (values.includes(custom)) {
      selected.push(yield* prompt<string>(() => text({ message: t("Enter value"), validate: required })))
    }
    if (field.minItems !== undefined && selected.length < field.minItems) {
      return yield* Effect.fail(new Error(t("Select at least {value}", { value: field.minItems })))
    }
    if (field.maxItems !== undefined && selected.length > field.maxItems) {
      return yield* Effect.fail(new Error(t("Select at most {value}", { value: field.maxItems })))
    }
    return selected
  }
  if (field.type === "string" && field.options) {
    const options: Array<Option<string | typeof custom | typeof skip>> = field.options.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.description,
    }))
    if (field.custom) options.push({ value: custom, label: t("Type your own answer") })
    if (!field.required) options.push({ value: skip, label: t("Skip") })
    const value = yield* prompt<string | typeof custom | typeof skip>(() =>
      select<string | typeof custom | typeof skip>({ message, options, initialValue: field.default }),
    )
    if (value === skip) return undefined
    if (value !== custom) return value
  }
  const value = yield* prompt<string>(() =>
    text({
      message,
      placeholder: field.type === "string" ? field.placeholder : undefined,
      initialValue: field.default === undefined ? undefined : String(field.default),
      validate: (input) => validateText(field, input),
    }),
  )
  if (!value && !field.required) return undefined
  if (field.type === "string") return value
  return Number(value)
})

function active(field: FormField, answer: FormAnswer) {
  if (field.type === "external" || !field.when) return true
  return field.when.every((condition) => {
    const value = answer[condition.key]
    if (value === undefined) return false
    const matches = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value
    return condition.op === "eq" ? matches : !matches
  })
}

function required(value: string | undefined) {
  return value ? undefined : t("Answer required")
}

function validateText(field: Exclude<FormField, { type: "boolean" | "external" | "multiselect" }>, value?: string) {
  if (!value) return field.required ? t("Answer required") : undefined
  if (field.type === "number" || field.type === "integer") {
    const number = Number(value)
    if (!Number.isFinite(number)) return t("Expected a number")
    if (field.type === "integer" && !Number.isInteger(number)) return t("Expected an integer")
    if (typeof field.minimum === "number" && number < field.minimum)
      return t("Must be at least {value}", { value: field.minimum })
    if (typeof field.maximum === "number" && number > field.maximum)
      return t("Must be at most {value}", { value: field.maximum })
    return undefined
  }
  if (field.minLength !== undefined && value.length < field.minLength)
    return t("Must be at least {min} characters", { min: field.minLength })
  if (field.maxLength !== undefined && value.length > field.maxLength)
    return t("Must be at most {max} characters", { max: field.maxLength })
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value)) return t("Invalid format")
    } catch {
      return t("Invalid format")
    }
  }
  if (field.format === "uri" && !URL.canParse(value)) return t("Expected a URL")
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return t("Expected an email address")
  if (field.format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return t("Expected a date (YYYY-MM-DD)")
    const date = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
      return t("Expected a date (YYYY-MM-DD)")
  }
  if (field.format === "date-time" && Number.isNaN(Date.parse(value))) return t("Expected a date and time")
  return undefined
}
