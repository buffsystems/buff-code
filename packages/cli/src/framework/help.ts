import { Array as Arr, Option } from "effect"
import { CliOutput, type HelpDoc } from "effect/unstable/cli"
import type { BuffI18n } from "@opencode/schema/buff-i18n"

/**
 * Справка команд на языке человека (#628, правило #713). Описания команд, аргументов и флагов —
 * и свои, и встроенные в effect/cli (`--help`, `--version`, …) — пишутся по-английски и
 * переводятся здесь, при показе, по общему каталогу. Подписи разделов (USAGE, FLAGS, …) и
 * «(optional)» effect/cli вписывает сам, поэтому их переводим в готовом тексте: это строки
 * целиком (подпись — отдельная строка, «(optional)» — конец строки аргумента). Имена команд,
 * флагов, типов и строка USAGE — синтаксис, их не трогаем.
 */

const SECTIONS = ["DESCRIPTION", "USAGE", "ARGUMENTS", "FLAGS", "GLOBAL FLAGS", "SUBCOMMANDS", "EXAMPLES"]
const SECTION = new RegExp(`^(\\x1b\\[1m)?(${SECTIONS.join("|")})(\\x1b\\[0m)?$`)
// oxlint-disable-next-line no-control-regex
const OPTIONAL = /(\x1b\[2m)? \(optional\)(\x1b\[0m)?$/
const CHOICES = /^(.*?) ?\(choices: ([^()]*)\)$/

/** Описание на языке человека; хвост «(choices: …)» effect/cli переводится отдельно. */
export function localize(text: string, t: BuffI18n.T): string {
  const choices = CHOICES.exec(text)
  if (!choices) return text && t(text)
  const head = choices[1] ? `${t(choices[1])} ` : ""
  return `${head}(${t("choices: {list}", { list: choices[2]! })})`
}

function translateDoc(doc: HelpDoc.HelpDoc, t: BuffI18n.T): HelpDoc.HelpDoc {
  const text = (value: Option.Option<string>) => Option.map(value, (description) => localize(description, t))
  const flag = (item: HelpDoc.FlagDoc): HelpDoc.FlagDoc => ({ ...item, description: text(item.description) })
  return {
    ...doc,
    description: localize(doc.description, t),
    flags: doc.flags.map(flag),
    globalFlags: doc.globalFlags?.map(flag),
    args: doc.args?.map((arg) => ({ ...arg, description: text(arg.description) })),
    subcommands: doc.subcommands?.map((group) => ({
      ...group,
      commands: Arr.map(group.commands, (command) => ({
        ...command,
        description: localize(command.description, t),
        shortDescription: command.shortDescription && localize(command.shortDescription, t),
      })),
    })),
    examples: doc.examples?.map((example) => ({
      ...example,
      description: example.description && localize(example.description, t),
    })),
  }
}

function relabel(text: string, t: BuffI18n.T): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(SECTION, (_, open = "", label: string, close = "") => `${open}${t(label)}${close}`)
        .replace(OPTIONAL, (_, open = "", close = "") => `${open} (${t("optional")})${close}`),
    )
    .join("\n")
}

/** Справка effect/cli на языке `t`: `base` рисует переведённый документ, подписи — переводятся. */
export function format(doc: HelpDoc.HelpDoc, t: BuffI18n.T, base: CliOutput.Formatter): string {
  return relabel(base.formatHelpDoc(translateDoc(doc, t)), t)
}

export * as Help from "./help"
