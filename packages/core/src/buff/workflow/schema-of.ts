export * as WorkflowSchemaOf from "./schema-of.js"

import ts from "typescript"

/**
 * Схема результата `ask<T>` (#448) — из типа T, как в ZCode: актёр получает её как форму ответа,
 * JSDoc свойства становится описанием поля, литеральные объединения — перечислением.
 */

export type JsonSchema = Readonly<Record<string, unknown>>

const literalValues = (types: readonly ts.Type[]) =>
  types.map((type) => (type.isStringLiteral() || type.isNumberLiteral() ? type.value : undefined))

function describe(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
  return text || undefined
}

export function schemaOf(type: ts.Type, checker: ts.TypeChecker, depth = 0): JsonSchema {
  if (depth > 32) return {}
  const flags = type.getFlags()
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
  if (flags & ts.TypeFlags.StringLike && !type.isUnion())
    return type.isStringLiteral() ? { type: "string", enum: [type.value] } : { type: "string" }
  if (flags & ts.TypeFlags.NumberLike && !type.isUnion())
    return type.isNumberLiteral() ? { type: "number", enum: [type.value] } : { type: "number" }
  if (flags & ts.TypeFlags.BooleanLike) return { type: "boolean" }
  if (flags & ts.TypeFlags.Null) return { type: "null" }
  if (type.isUnion()) {
    const parts = type.types.filter((part) => !(part.getFlags() & ts.TypeFlags.Undefined))
    if (parts.every((part) => part.getFlags() & ts.TypeFlags.BooleanLike)) return { type: "boolean" }
    const values = literalValues(parts)
    if (values.every((value) => typeof value === "string")) return { type: "string", enum: values }
    if (values.every((value) => typeof value === "number")) return { type: "number", enum: values }
    if (parts.length === 1) return schemaOf(parts[0]!, checker, depth + 1)
    return { anyOf: parts.map((part) => schemaOf(part, checker, depth + 1)) }
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const item = checker.getTypeArguments(type as ts.TypeReference)[0]
    return { type: "array", items: item ? schemaOf(item, checker, depth + 1) : {} }
  }
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String)
  const properties = checker.getPropertiesOfType(type)
  if (index && !properties.length)
    return { type: "object", additionalProperties: schemaOf(index.type, checker, depth + 1) }
  const props: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    const value = declaration ? checker.getTypeOfSymbolAtLocation(property, declaration) : checker.getAnyType()
    const description = describe(property, checker)
    props[property.name] = { ...schemaOf(value, checker, depth + 1), ...(description ? { description } : {}) }
    if (!(property.getFlags() & ts.SymbolFlags.Optional)) required.push(property.name)
  }
  return { type: "object", properties: props, required, additionalProperties: false }
}
