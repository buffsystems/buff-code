import type { CliError } from "effect/unstable/cli"
import type { BuffI18n } from "@opencode/schema/buff-i18n"

/**
 * Ошибки разбора командной строки на языке человека (#628, правило #713). effect/cli отдаёт их
 * разобранными (вид ошибки и её поля), а текст собирает по-английски в `message`; здесь тот же
 * текст собирается через перевод: английские ключи каталога повторяют фразы effect/cli, поэтому
 * по-английски выходит ровно его текст. Пояснение «что ожидалось» effect/cli передаёт готовой
 * строкой (от схемы, от разбора значения или от команды) — известные фразы узнаются по образцу,
 * незнакомая идёт через каталог как есть.
 */

type Pattern = readonly [RegExp, string]

/** Фразы effect/cli и схемы в пояснении «что ожидалось»; имена групп — параметры ключа. */
const EXPECTED: readonly Pattern[] = [
  [/^Schema validation failed: (?<reason>.*)$/s, "Schema validation failed: {reason}"],
  [/^Expected a value between (?<min>\S+) and (?<max>\S+)$/, "Expected a value between {min} and {max}"],
  [/^Expected a value greater than or equal to (?<min>\S+)$/, "Expected a value greater than or equal to {min}"],
  [/^Expected a value less than or equal to (?<max>\S+)$/, "Expected a value less than or equal to {max}"],
  [/^Expected a value with a length of at least (?<min>\S+)$/, "Expected a value with a length of at least {min}"],
  [/^Expected (?<list>".*)$/, "Expected {list}"],
  [
    /^Invalid key=value format\. Expected format: key=value, got: (?<value>.*)$/s,
    "Invalid key=value format. Expected format: key=value, got: {value}",
  ],
  [
    /^Invalid key=value format\. Both key and value must be non-empty\. Got: (?<value>.*)$/s,
    "Invalid key=value format. Both key and value must be non-empty. Got: {value}",
  ],
  [
    /^omit the value and use (?<raw>\S+) by itself to set --(?<name>\S+) to false$/,
    "omit the value and use {raw} by itself to set --{name} to false",
  ],
]
const COUNT = /^at (?<bound>least|most) (?<count>\d+) values?$/
const VALUES = /^(?<count>\d+) values?$/

/** Пояснение «что ожидалось» на языке `t`. */
export function expected(text: string, t: BuffI18n.T, n: BuffI18n.N): string {
  const count = COUNT.exec(text)?.groups
  if (count) {
    const forms =
      count.bound === "least" ? "at least {n} value|at least {n} values" : "at most {n} value|at most {n} values"
    return n(Number(count.count), forms)
  }
  for (const [pattern, key] of EXPECTED) {
    const groups = pattern.exec(text)?.groups
    if (!groups) continue
    const params = groups.reason === undefined ? groups : { ...groups, reason: expected(groups.reason, t, n) }
    return t(key, params)
  }
  return t(text)
}

function suggestions(list: ReadonlyArray<string>, t: BuffI18n.T): string {
  return list.length > 0 ? `\n\n  ${t("Did you mean this?")}\n    ${list.join("\n    ")}` : ""
}

function invalid(error: CliError.InvalidValue, t: BuffI18n.T, n: BuffI18n.N): string {
  // Фразу «Expected …» effect/cli показывает как есть, остальное — после «Expected:».
  const sentence = error.expected.startsWith("Expected ") || error.expected.startsWith("Expected:")
  const reason = expected(error.expected, t, n)
  const expectation = sentence ? reason : t("Expected: {what}", { what: reason })
  const value = VALUES.exec(error.value)?.groups
  const shown = value ? n(Number(value.count), "{n} value|{n} values") : error.value
  if (error.kind === "argument")
    return t('Invalid value for argument <{name}>: "{value}". {expectation}', {
      name: error.option,
      value: shown,
      expectation,
    })
  if (error.value.length === 0)
    return t("Missing value for flag --{name}. {expectation}", { name: error.option, expectation })
  return t('Invalid value for flag --{name}: "{value}". {expectation}', {
    name: error.option,
    value: shown,
    expectation,
  })
}

/** Текст ошибки effect/cli на языке `t`; ошибки команд (UserError) уже написаны на нём. */
export function message(error: CliError.CliError, t: BuffI18n.T, n: BuffI18n.N): string {
  switch (error._tag) {
    case "UnrecognizedOption":
      return (
        (error.command
          ? t("Unrecognized flag: {option} in command {command}", {
              option: error.option,
              command: error.command.join(" "),
            })
          : t("Unrecognized flag: {option}", { option: error.option })) + suggestions(error.suggestions, t)
      )
    case "DuplicateOption":
      return t(
        'Duplicate flag name "{option}" in parent command "{parent}" and subcommand "{child}". Parent will always claim this flag (Mode A semantics). Consider renaming one of them to avoid confusion.',
        { option: error.option, parent: error.parentCommand, child: error.childCommand },
      )
    case "MissingOption":
      return t("Missing required flag: --{option}", { option: error.option })
    case "MissingArgument":
      return t("Missing required argument: {argument}", { argument: error.argument })
    case "UnexpectedArgument":
      return n(
        error.arguments.length,
        "Unexpected positional argument: {list}|Unexpected positional arguments: {list}",
        { list: error.arguments.map((value) => JSON.stringify(value)).join(", ") },
      )
    case "InvalidValue":
      return invalid(error, t, n)
    case "UnknownSubcommand":
      return (
        (error.parent
          ? t('Unknown subcommand "{name}" for "{parent}"', { name: error.subcommand, parent: error.parent.join(" ") })
          : t('Unknown subcommand "{name}"', { name: error.subcommand })) + suggestions(error.suggestions, t)
      )
    default:
      return error.message
  }
}

export * as Errors from "./errors"
