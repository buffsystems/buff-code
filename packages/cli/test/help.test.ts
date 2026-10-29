// Справка `buff --help` на языке человека (#628, правило #713): русский или английский по языку системы.
import { NodeServices } from "@effect/platform-node"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { describe, expect, test } from "bun:test"
import { Context, Effect, Option } from "effect"
import { CliOutput, Command, type HelpDoc } from "effect/unstable/cli"
import path from "node:path"
import { Commands } from "../src/commands/commands"
import { Help } from "../src/framework/help"
import { Output } from "../src/framework/output"
import { Runtime } from "../src/framework/runtime"
import type { Spec } from "../src/framework/spec"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const en: BuffI18n.T = (text, params) => BuffI18n.t("en", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)
const enN: BuffI18n.N = (count, forms, params) => BuffI18n.n("en", count, forms, params)
const CYRILLIC = /[а-яё]/i
const LABELS = ["DESCRIPTION", "USAGE", "ARGUMENTS", "FLAGS", "GLOBAL FLAGS", "SUBCOMMANDS"]

const doc: HelpDoc.HelpDoc = {
  description: "Manage sessions",
  usage: "buff session <subcommand> [flags]",
  annotations: Context.empty(),
  args: [
    {
      name: "target",
      type: "string",
      description: Option.some("Integration ID or name"),
      required: false,
      variadic: false,
    },
  ],
  flags: [
    {
      name: "format",
      aliases: [],
      type: "choice",
      description: Option.some("Output format (choices: table, json)"),
      required: false,
    },
  ],
  globalFlags: [
    {
      name: "help",
      aliases: ["-h"],
      type: "boolean",
      description: Option.some("Show help information"),
      required: false,
    },
  ],
  subcommands: [
    {
      group: undefined,
      commands: [{ name: "list", alias: undefined, shortDescription: undefined, description: "List plugins" }],
    },
  ],
}

describe("оформитель справки", () => {
  for (const colors of [false, true])
    test(`по-русски — подписи, пометки и описания (${colors ? "в цвете" : "без цвета"})`, () => {
      const text = Output.formatter(ru, ruN, CliOutput.defaultFormatter({ colors })).formatHelpDoc(doc)
      for (const label of ["ОПИСАНИЕ", "ИСПОЛЬЗОВАНИЕ", "АРГУМЕНТЫ", "ФЛАГИ", "ОБЩИЕ ФЛАГИ", "ПОДКОМАНДЫ"])
        expect(text).toContain(label)
      expect(text).toContain("ID или имя интеграции")
      expect(text).toContain("(необязательно)")
      expect(text).toContain("Формат вывода (варианты: table, json)")
      expect(text).toContain("Показать справку")
      expect(text).toContain("buff session <subcommand> [flags]")
      for (const label of LABELS) expect(text).not.toMatch(new RegExp(`^(\\x1b\\[1m)?${label}(\\x1b\\[0m)?$`, "m"))
    })

  test("по-английски — как у effect/cli", () => {
    const base = CliOutput.defaultFormatter({ colors: false })
    expect(Output.formatter(en, enN, base).formatHelpDoc(doc)).toBe(base.formatHelpDoc(doc))
  })
})

/** Справка каждой команды дерева — так, как её строит effect/cli. */
async function helpDocs(): Promise<HelpDoc.HelpDoc[]> {
  const docs: HelpDoc.HelpDoc[] = []
  const capture = {
    ...CliOutput.defaultFormatter({ colors: false }),
    formatHelpDoc: (doc: HelpDoc.HelpDoc) => (docs.push(doc), ""),
  }
  const paths: string[][] = []
  const walk = (node: Spec.Any, at: string[]) => {
    paths.push(at)
    for (const [name, child] of Object.entries(node.commands)) walk(child, [...at, name])
  }
  walk(Commands, [])
  // Без обработчиков: --help их не вызывает, поэтому и служб, которые им нужны, не требует.
  const tree = Runtime.command(Commands, []) as Command.Command<string, unknown, unknown, unknown, never>
  for (const at of paths)
    await Effect.runPromise(
      Command.runWith(tree, { version: "0" })([...at, "--help"]).pipe(
        Effect.provide(CliOutput.layer(capture)),
        Effect.provide(NodeServices.layer),
      ),
    )
  return docs
}

test("у каждого описания в справке есть русский перевод", async () => {
  const docs = await helpDocs()
  const texts = new Set<string>()
  for (const item of docs) {
    texts.add(item.description)
    for (const entry of [...item.flags, ...(item.globalFlags ?? []), ...(item.args ?? [])])
      Option.map(entry.description, (text) => texts.add(text))
    for (const group of item.subcommands ?? []) for (const command of group.commands) texts.add(command.description)
  }
  const untranslated = [...texts].filter((text) => text && !CYRILLIC.test(Help.localize(text, ru)))
  expect(untranslated).toEqual([])
  const english = docs.map((item) =>
    Output.formatter(en, enN, CliOutput.defaultFormatter({ colors: false })).formatHelpDoc(item),
  )
  expect(english.filter((text) => CYRILLIC.test(text))).toEqual([])
})

async function cli(args: string[], lang: string) {
  const { LANGUAGE: _language, LC_ALL: _all, LC_MESSAGES: _messages, ...env } = process.env
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...env, LANG: lang },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return { stdout, exitCode }
}

describe("buff --help по языку системы", () => {
  test("английская система — справка без кириллицы", async () => {
    const help = await cli(["--help"], "en_US.UTF-8")
    expect(help.exitCode).toBe(0)
    for (const label of LABELS) expect(help.stdout).toContain(label)
    expect(help.stdout).not.toMatch(CYRILLIC)
  })

  test("русская или неопределённая система — подписи и описания всех подкоманд по-русски", async () => {
    for (const lang of ["ru_RU.UTF-8", "C.UTF-8"]) {
      const help = await cli(["--help"], lang)
      expect(help.exitCode).toBe(0)
      for (const label of ["ОПИСАНИЕ", "ИСПОЛЬЗОВАНИЕ", "ФЛАГИ", "ОБЩИЕ ФЛАГИ", "ПОДКОМАНДЫ"])
        expect(help.stdout).toContain(label)
      const rows = help.stdout.split("ПОДКОМАНДЫ\n")[1]!.trim().split("\n")
      expect(rows.map((row) => row.trim().split(/\s{2,}/)[0])).toEqual(
        Object.keys(Commands.commands).map((name) => (name === "upgrade" ? "upgrade, update" : name)),
      )
      expect(rows.filter((row) => !CYRILLIC.test(row))).toEqual([])
    }
  })
})
