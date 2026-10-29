// Ошибки разбора командной строки на языке человека (#628, правило #713).
import { NodeServices } from "@effect/platform-node"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { type CliError, CliOutput, Command } from "effect/unstable/cli"
import path from "node:path"
import { Commands } from "../src/commands/commands"
import { Output } from "../src/framework/output"
import { Runtime } from "../src/framework/runtime"

const ru = Output.formatter(
  (text, params) => BuffI18n.t("ru", text, params),
  (count, forms, params) => BuffI18n.n("ru", count, forms, params),
  CliOutput.defaultFormatter({ colors: false }),
)
const en = Output.formatter(
  (text, params) => BuffI18n.t("en", text, params),
  (count, forms, params) => BuffI18n.n("en", count, forms, params),
  CliOutput.defaultFormatter({ colors: false }),
)
const base = CliOutput.defaultFormatter({ colors: false })
const CYRILLIC = /[а-яё]/i

// Каждый вид ошибки и каждое пояснение «что ожидалось», которые даёт дерево команд buff.
const CASES = [
  ["stats", "--days", "abc"],
  ["stats", "--days", "1.5"],
  ["stats", "--year", "1"],
  ["stats", "--limit", "0"],
  ["session", "list", "--format", "xml"],
  ["mcp", "add", "x", "--header", "foo"],
  ["mcp", "add", "x", "--env", "a="],
  ["stats", "--json=maybe"],
  ["stats", "--no-json=1"],
  ["models", "--server"],
  ["pair", "--url", "ftp://x"],
  ["serve", "--cors", ""],
  ["api"],
  ["service", "get", "a", "b", "c"],
  ["service", "get", "a", "b", "c", "d"],
  ["--bogus"],
  ["stats", "--modls"],
  ["auth", "lgin"],
  ["session", "delete"],
]

/** Ошибки разбора, как их отдаёт effect/cli, — без запуска команд. */
async function parseErrors(args: string[]): Promise<CliError.CliError[]> {
  const errors: CliError.CliError[] = []
  const capture = {
    ...base,
    formatHelpDoc: () => "",
    formatErrors: (list: ReadonlyArray<CliError.CliError>) => (errors.push(...list), ""),
  }
  const tree = Runtime.command(Commands, []) as Command.Command<string, unknown, unknown, unknown, never>
  await Effect.runPromise(
    Command.runWith(tree, { version: "0" })(args).pipe(
      Effect.provide(CliOutput.layer(capture)),
      Effect.provide(NodeServices.layer),
      Effect.ignore,
    ),
  )
  return errors
}

describe("ошибки разбора", () => {
  test("по-английски — ровно текст effect/cli, по-русски — русский", async () => {
    const all = (await Promise.all(CASES.map(parseErrors))).flat()
    expect(new Set(all.map((error) => error._tag))).toEqual(
      new Set(["InvalidValue", "UnexpectedArgument", "UnrecognizedOption", "UnknownSubcommand", "MissingArgument"]),
    )
    for (const error of all) {
      const english = en.formatErrors([error])
      expect(english).toBe(base.formatErrors([error]))
      expect(english).not.toMatch(CYRILLIC)
      const russian = ru.formatErrors([error])
      expect(russian).toContain("ОШИБКА")
      expect(russian).not.toMatch(/\b(Invalid|Expected|Missing|Unknown|Unrecognized|Unexpected|Schema|Did you)\b/)
    }
    expect(ru.formatErrors(all.slice(0, 2))).toContain("ОШИБКИ")
  })

  test("пояснения и числа — по правилам языка", async () => {
    const [year] = await parseErrors(["stats", "--year", "1"])
    expect(ru.formatErrors([year!])).toContain(
      "Неверное значение флага --year: «1». Ожидается: значение от 1970 до 9999",
    )
    const [api] = await parseErrors(["api"])
    expect(ru.formatErrors([api!])).toContain("«0 значений». Ожидается: не меньше 1 значения")
    const [extra] = await parseErrors(["service", "get", "a", "b", "c", "d"])
    expect(ru.formatErrors([extra!])).toContain('Лишние аргументы: "c", "d"')
    const [typo] = await parseErrors(["auth", "lgin"])
    expect(ru.formatErrors([typo!])).toContain(
      "Неизвестная подкоманда «lgin» у «opencode auth»\n\n  Может быть, имелось в виду:\n    login",
    )
  })

  test("в цвете подпись тоже переводится", async () => {
    const [error] = await parseErrors(["--bogus"])
    const colored = Output.formatter(
      (text, params) => BuffI18n.t("ru", text, params),
      (count, forms, params) => BuffI18n.n("ru", count, forms, params),
      CliOutput.defaultFormatter({ colors: true }),
    ).formatErrors([error!])
    expect(colored).toContain("\x1b[1m\x1b[31mОШИБКА\x1b[0m")
  })
})

async function cli(args: string[], lang: string) {
  const { LANGUAGE: _language, LC_ALL: _all, LC_MESSAGES: _messages, ...env } = process.env
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...env, LANG: lang },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  return { stderr, exitCode }
}

describe("buff с неверными аргументами", () => {
  test("ошибка значения общего флага — коротко, без стека, на языке системы", async () => {
    const [english, russian] = await Promise.all([
      cli(["--log-level", "bad"], "en_US.UTF-8"),
      cli(["--log-level", "bad"], "ru_RU.UTF-8"),
    ])
    expect(english.exitCode).toBe(1)
    expect(english.stderr).toContain('Invalid value for flag --log-level: "bad"')
    expect(english.stderr).not.toMatch(CYRILLIC)
    expect(russian.exitCode).toBe(1)
    expect(russian.stderr).toContain("ОШИБКА\n  Неверное значение флага --log-level: «bad»")
    for (const result of [english, russian]) expect(result.stderr).not.toContain("    at ")
  })

  test("неизвестная подкоманда — на языке системы", async () => {
    const [english, russian] = await Promise.all([
      cli(["auth", "lgin"], "en_US.UTF-8"),
      cli(["auth", "lgin"], "C.UTF-8"),
    ])
    expect(english.stderr).toContain('Unknown subcommand "lgin"')
    expect(english.stderr).not.toMatch(CYRILLIC)
    expect(russian.stderr).toContain("Неизвестная подкоманда «lgin»")
    expect(russian.exitCode).toBe(1)
  })
})
