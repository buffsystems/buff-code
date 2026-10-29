// Мастер команды (`buff --wizard`) на языке человека (#628, правило #713).
import { NodeServices } from "@effect/platform-node"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { describe, expect, test } from "bun:test"
import { type Cause, Console, Effect, Option, Queue, Terminal } from "effect"
import { CliConfig, CliOutput, Command } from "effect/unstable/cli"
import { Commands } from "../src/commands/commands"
import { Output } from "../src/framework/output"
import { Runtime } from "../src/framework/runtime"

const CYRILLIC = /[а-яё]/i
type Lang = "ru" | "en"

const key = (name: string, input?: string): Terminal.UserInput => ({
  input: Option.fromNullishOr(input),
  key: { name, ctrl: false, meta: false, shift: false },
})
const enter = key("enter")
const typed = (text: string) => [...text].map((char) => key(char, char))

/** Мастер на поддельном терминале: нажатия — заранее, кончились — человек нажал Ctrl+C. */
async function wizard(args: string[], keys: Terminal.UserInput[], lang: Lang) {
  const shown: string[] = []
  const printed: string[] = []
  const t: BuffI18n.T = (text, params) => BuffI18n.t(lang, text, params)
  const n: BuffI18n.N = (count, forms, params) => BuffI18n.n(lang, count, forms, params)
  const input = await Effect.runPromise(Queue.unbounded<Terminal.UserInput, Cause.Done>())
  Queue.offerAllUnsafe(input, keys)
  Queue.endUnsafe(input)
  const terminal = Terminal.make({
    columns: Effect.succeed(120),
    rows: Effect.succeed(40),
    readInput: Effect.succeed(input),
    readLine: Effect.never,
    display: (text) => Effect.sync(() => void shown.push(text)),
  })
  const console = { ...globalThis.console, log: (...parts: unknown[]) => void printed.push(parts.join(" ")) }
  const tree = Runtime.command(Commands, []) as Command.Command<string, unknown, unknown, unknown, never>
  await Effect.runPromise(
    Command.runWith(tree, { version: "0" })(args).pipe(
      Effect.provide(CliConfig.layer({ builtIns: Runtime.builtIns(Commands, t, () => args) })),
      Effect.provide(CliOutput.layer(Output.formatter(t, n, CliOutput.defaultFormatter({ colors: false })))),
      Effect.provideService(Terminal.Terminal, terminal),
      Effect.provideService(Console.Console, console as Console.Console),
      Effect.provide(NodeServices.layer),
      Effect.ignore,
    ),
  )
  return { screen: shown.join(""), output: printed.join("\n") }
}

// session delete: два необязательных флага — «нет», ID сессии, «запустить?» — «нет».
const DELETE = [enter, enter, ...typed("ses_1"), enter, key("right"), enter]
// Корень: выбрать первую подкоманду (upgrade), флаг и аргумент — «нет», «запустить?» — «нет».
const ROOT = [enter, enter, enter, key("right"), enter]

describe("мастер команды", () => {
  test("по-русски — подписи, вопросы и ответы", async () => {
    const run = await wizard(["session", "delete", "--wizard"], DELETE, "ru")
    for (const text of [
      "Мастер команды",
      "Соберите команду по шагам",
      "ФЛАГИ",
      "АРГУМЕНТЫ",
      "Текущая команда",
      "Команда готова",
    ])
      expect(run.output).toContain(text)
    expect(run.output).toContain("$ opencode session delete ses_1")
    for (const text of ["Задать", "ID сессии, которую удалить", "Запустить эту команду?", "да", "нет"])
      expect(run.screen).toContain(text)
    expect(run.output + run.screen).not.toMatch(/\b(Set|Command|Current|Run this|yes|no)\b/)
  })

  test("по-английски — без кириллицы", async () => {
    const run = await wizard(["session", "delete", "--wizard"], DELETE, "en")
    expect(run.output).toContain("Command wizard")
    expect(run.output).toContain("$ opencode session delete ses_1")
    expect(run.screen).toContain("Run this command?")
    expect(run.output + run.screen).not.toMatch(CYRILLIC)
  })

  test("выбор подкоманды — с описаниями на языке человека", async () => {
    const ru = await wizard(["--wizard"], ROOT, "ru")
    expect(ru.screen).toContain("Команда")
    expect(ru.screen).toContain("Обновить Buff Code до последней или указанной версии")
    expect(ru.output).toContain("$ opencode upgrade")
    const en = await wizard(["--wizard"], ROOT, "en")
    expect(en.screen).toContain("Upgrade Buff Code to the latest or a specific version")
    expect(en.output + en.screen).not.toMatch(CYRILLIC)
  })

  test("Ctrl+C — мастер отменён, на языке человека", async () => {
    expect((await wizard(["session", "delete", "--wizard"], [], "ru")).output).toContain("Мастер отменён.")
    expect((await wizard(["session", "delete", "--wizard"], [], "en")).output).toContain("Wizard cancelled.")
  })
})
