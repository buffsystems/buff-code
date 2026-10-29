import { Console, Effect, Terminal } from "effect"
import { type CliError, Command, Flag, GlobalFlag, Param, Prompt } from "effect/unstable/cli"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { Help } from "./help"
import type { Spec } from "./spec"
import { type Line, WizardAsk } from "./wizard-ask"

/**
 * Мастер команды (`buff --wizard`) на языке человека (#628, правило #713). Мастер effect/cli
 * пишет свои подписи и вопросы по-английски и переводу не поддаётся, поэтому флаг `--wizard`
 * заменён своим: тот же порядок (раздел флагов, раздел аргументов, выбор подкоманды, итоговая
 * команда и вопрос «запустить?»), но тексты идут через каталог. Скрытые флаги мастер не предлагает.
 */

type T = BuffI18n.T

const ESC = "\x1b["
const paint = (text: string, ...codes: number[]) => `${ESC}${codes.join(";")}m${text}${ESC}0m`
const quote = (arg: string) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'"'"'`)}'`)

function block(label: string, words: ReadonlyArray<Line>, color: number, labelColor = 37): string {
  const command = words.map((word) => quote(word.shown)).join(" ")
  return [paint(label, 1, labelColor), paint(`  $ ${command}`, color), ""].join("\n")
}

const section = (name: string, title: string) =>
  `${paint(name.toUpperCase(), 1, 96)} ${paint("·", 90)} ${paint(title, 1, 37)}`

function child(node: Spec.Any, name: string): Spec.Any | undefined {
  return Object.values(node.commands).find((item) => item.name === name || item.spec.alias === name)
}

function walk(
  node: Spec.Any,
  commandLine: Line[],
  name: string,
  t: T,
): Effect.Effect<void, CliError.CliError | Terminal.QuitError, Command.Environment> {
  return Effect.gen(function* () {
    const children = Object.values(node.commands)
    const current = () => Console.log(block(t("Current command"), commandLine, 35))
    const visible = (children.length > 0 ? [] : WizardAsk.params(node.params)).filter(
      (param) => !WizardAsk.single(param).hidden,
    )
    const flags = visible.filter((param) => WizardAsk.single(param).kind === Param.flagKind)
    const args = visible.filter((param) => WizardAsk.single(param).kind === Param.argumentKind)
    if (flags.length > 0) {
      yield* Console.log(section(name, t("FLAGS")))
      for (const param of flags) commandLine.push(...(yield* WizardAsk.ask(param, t)))
      if (args.length > 0 || children.length > 0) yield* current()
    }
    if (args.length > 0) {
      yield* Console.log(section(name, t("ARGUMENTS")))
      for (const param of args) commandLine.push(...(yield* WizardAsk.ask(param, t)))
    }
    if (children.length === 0) return
    const next = yield* Prompt.run(
      Prompt.select({
        message: t("Command"),
        choices: children.map((item) => ({
          title: item.name,
          value: item,
          ...(item.spec.description ? { description: Help.localize(item.spec.description, t) } : {}),
        })),
      }),
    )
    yield* Console.log()
    commandLine.push(WizardAsk.line(next.name))
    yield* current()
    yield* walk(next, commandLine, next.name, t)
  })
}

/** Флаг `--wizard` с мастером на языке `t`; `args` — аргументы запуска (то, что уже набрано). */
export function flag(root: Spec.Any, t: T, args: () => ReadonlyArray<string>) {
  return GlobalFlag.action({
    flag: Flag.boolean("wizard").pipe(Flag.withDescription("Start wizard mode for a command")),
    // Действие общего флага effect/cli выполняет в своей среде (терминал, файлы); тип её не называет.
    run: (_, context) => run(root, t, args(), context) as Effect.Effect<void>,
  })
}

function run(root: Spec.Any, t: T, typed: ReadonlyArray<string>, context: GlobalFlag.HandlerContext) {
  return Effect.gen(function* () {
    let node = root
    for (const name of context.commandPath.slice(1)) node = child(node, name) ?? node
    const description = root.spec.description ? Help.localize(root.spec.description, t) : undefined
    const title = `${paint(context.command.name, 1, 96)} ${paint(`v${context.version}`, 37)}`
    yield* Console.log(
      [
        `${title} ${paint(`· ${t("Command wizard")}`, 1, 37)}`,
        ...(description ? [description] : []),
        paint(t("Build a command interactively. Press Ctrl+C to cancel."), 90),
        "",
      ].join("\n"),
    )
    const commandLine = [
      context.command.name,
      ...typed.filter((arg) => arg !== "--wizard" && !arg.startsWith("--wizard=")),
    ].map((arg) => WizardAsk.line(arg))
    yield* Console.log(block(t("Current command"), commandLine, 35))
    yield* walk(node, commandLine, node === root ? "ROOT" : node.name, t)
    yield* Console.log(block(t("Command ready"), commandLine, 96, 32))
    if (!(yield* WizardAsk.yesNo(t, t("Run this command?"), true))) return
    yield* Console.log()
    yield* Command.runWith(context.command, { version: context.version, renderErrors: false })(
      commandLine.slice(1).map((word) => word.value),
    )
  }).pipe(Effect.catchIf(Terminal.isQuitError, () => Console.log(`\n${paint(t("Wizard cancelled."), 31)}`)))
}

export * as Wizard from "./wizard"
