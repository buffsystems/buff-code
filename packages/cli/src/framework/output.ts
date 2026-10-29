import { type CliError, CliOutput } from "effect/unstable/cli"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { Errors } from "./errors"
import { Help } from "./help"

/**
 * Оформитель вывода effect/cli на языке человека (#628, правило #713): справка и ошибки разбора
 * командной строки. Цвет и раскладку рисует оформитель по умолчанию — ему передаются уже
 * переведённые тексты, а подписи «ERROR»/«ERRORS» (отдельные строки) переводятся в готовом выводе.
 */

// oxlint-disable-next-line no-control-regex
const HEADING = /^((?:\x1b\[[0-9;]*m)*)(ERRORS?)((?:\x1b\[[0-9;]*m)*)$/

function relabel(text: string, t: BuffI18n.T): string {
  return text
    .split("\n")
    .map((line) =>
      line.replace(HEADING, (_, open: string, label: string, close: string) => `${open}${t(label)}${close}`),
    )
    .join("\n")
}

/** Ошибка с переведённым текстом: оформитель по умолчанию читает только `_tag` и `message`. */
function translated(error: CliError.CliError, t: BuffI18n.T, n: BuffI18n.N): CliError.CliError {
  return { _tag: error._tag, message: Errors.message(error, t, n) } as unknown as CliError.CliError
}

/** Оформитель вывода effect/cli: справка и ошибки — на языке `t`/`n`. */
export function formatter(
  t: BuffI18n.T,
  n: BuffI18n.N,
  base: CliOutput.Formatter = CliOutput.defaultFormatter(),
): CliOutput.Formatter {
  return {
    ...base,
    formatHelpDoc: (doc) => Help.format(doc, t, base),
    formatCliError: (error) => base.formatCliError(translated(error, t, n)),
    formatError: (error) => relabel(base.formatError(translated(error, t, n)), t),
    formatErrors: (errors) => relabel(base.formatErrors(errors.map((error) => translated(error, t, n))), t),
  }
}

export * as Output from "./output"
