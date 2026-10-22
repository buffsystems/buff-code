export * as WorkflowValidate from "./validate.js"

import type { WorkflowSchemaOf } from "./schema-of.js"

/**
 * Проверка ответа актёра (#448) по схеме результата `ask<T>` — то подмножество JSON Schema,
 * которое выводит `schema-of.ts`. Каждое несовпадение названо местом и словами: актёр видит
 * их в ответе инструмента и исправляет.
 */

const KIND: Record<string, string> = {
  string: "expected a string",
  number: "expected a number",
  boolean: "expected true/false",
  object: "expected an object",
  array: "expected an array",
  null: "expected null",
}

const fits = (type: string, value: unknown) =>
  type === "array"
    ? Array.isArray(value)
    : type === "object"
      ? typeof value === "object" && value !== null && !Array.isArray(value)
      : type === "null"
        ? value === null
        : typeof value === type && (type !== "number" || Number.isFinite(value))

export function problems(value: unknown, schema: WorkflowSchemaOf.JsonSchema, place = "(result)"): string[] {
  const anyOf = schema.anyOf as WorkflowSchemaOf.JsonSchema[] | undefined
  if (anyOf)
    return anyOf.some((option) => problems(value, option, place).length === 0)
      ? []
      : [`${place}: matches none of the variants`]
  const type = schema.type as string | undefined
  if (type && !fits(type, value)) return [`${place}: ${KIND[type] ?? `expected ${type}`}`]
  const values = schema.enum as unknown[] | undefined
  if (values && !values.includes(value)) return [`${place}: one of ${values.join(", ")}`]
  if (type === "array") {
    const items = (schema.items ?? {}) as WorkflowSchemaOf.JsonSchema
    return (value as unknown[]).flatMap((item, index) =>
      problems(item, items, `${place === "(result)" ? "" : place}[${index}]`),
    )
  }
  if (type !== "object") return []
  const record = value as Record<string, unknown>
  const properties = (schema.properties ?? {}) as Record<string, WorkflowSchemaOf.JsonSchema>
  const join = (key: string) => (place === "(result)" ? key : `${place}.${key}`)
  const missing = ((schema.required ?? []) as string[])
    .filter((key) => !(key in record))
    .map((key) => `${join(key)}: required field is missing`)
  const fields = Object.entries(record).flatMap(([key, item]) => {
    if (key in properties) return problems(item, properties[key]!, join(key))
    if (schema.additionalProperties === false) return [`${join(key)}: no such field in the schema`]
    const extra = schema.additionalProperties
    return typeof extra === "object" && extra !== null
      ? problems(item, extra as WorkflowSchemaOf.JsonSchema, join(key))
      : []
  })
  return [...missing, ...fields]
}
