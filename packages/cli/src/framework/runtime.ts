import { Console, Effect, FileSystem, Runtime, Scope } from "effect"
import { CliConfig, CliError, CliOutput, Command, GlobalFlag } from "effect/unstable/cli"
import { PrintLogs } from "../commands/commands"
import { Spec } from "./spec"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { Output } from "./output"
import { Wizard } from "./wizard"
import { n, t } from "../buff/locale"
import { Global } from "@opencode/util/global"
import { Updater } from "../services/updater"
import { Config } from "../config"
import { Npm } from "@opencode/util/npm"

export type Input<Value> =
  Value extends Spec.Node<infer _Name, infer Command, infer _Commands>
    ? Input<Command>
    : Value extends Command.Command<infer _Name, infer Input, infer _Context, infer _Error, infer _Requirements>
      ? Input
      : never

type RuntimeHandler = (
  input: unknown,
) => Effect.Effect<
  void,
  unknown,
  FileSystem.FileSystem | Global.Service | Npm.Service | Updater.Service | Config.Service | Scope.Scope
>
type Loader<Node extends Spec.Any> = () => Promise<{
  default: (
    input: Input<Node>,
  ) => Effect.Effect<
    void,
    any,
    FileSystem.FileSystem | Global.Service | Npm.Service | Updater.Service | Config.Service | Scope.Scope
  >
}>
type ProvidedCommand = Command.Command<
  string,
  unknown,
  unknown,
  unknown,
  FileSystem.FileSystem | Global.Service | Npm.Service | Updater.Service | Config.Service | Scope.Scope
>

export type Handlers<Node extends Spec.Any> = keyof Node["commands"] extends never
  ? Loader<Node>
  : { readonly $?: Loader<Node> } & { readonly [Key in keyof Node["commands"]]: Handlers<Node["commands"][Key]> }

interface LazyHandler {
  readonly spec: Command.Command.Any
  readonly load: () => Promise<{ default: RuntimeHandler }>
}

type RuntimeHandlers =
  | (() => Promise<{ default: RuntimeHandler }>)
  | {
      readonly $?: () => Promise<{ default: RuntimeHandler }>
      readonly [key: string]: RuntimeHandlers | (() => Promise<{ default: RuntimeHandler }>) | undefined
    }

export function handler<const Node extends Spec.Any, Error, Requirements>(
  _node: Node,
  run: (input: Input<Node>) => Effect.Effect<void, Error, Requirements>,
) {
  return run
}

export function handlers<const Root extends Spec.Any>(root: Root, handlers: Handlers<Root>) {
  const result: LazyHandler[] = []

  function add(node: Spec.Any, value: RuntimeHandlers) {
    if (typeof value === "function") {
      result.push({ spec: node.spec, load: value as () => Promise<{ default: RuntimeHandler }> })
      for (const alias of node.aliases) result.push({ spec: alias.spec, load: value as () => Promise<{ default: RuntimeHandler }> })
      return
    }
    if (value.$) {
      result.push({ spec: node.spec, load: value.$ as () => Promise<{ default: RuntimeHandler }> })
      for (const alias of node.aliases) result.push({ spec: alias.spec, load: value.$ as () => Promise<{ default: RuntimeHandler }> })
    }
    for (const [name, child] of Object.entries(node.commands)) add(child, value[name] as RuntimeHandlers)
  }

  add(root, handlers as RuntimeHandlers)
  return result
}

/** Дерево команд с обработчиками и общими флагами — то, что разбирает и показывает в справке effect/cli. */
export function command(commands: Spec.Any, handlers: ReadonlyArray<LazyHandler>) {
  return provide(commands, handlers).pipe(Command.withGlobalFlags([PrintLogs]))
}

export function run(commands: Spec.Any, handlers: ReadonlyArray<LazyHandler>, options: { readonly version: string }) {
  // Справка и ошибки разбора — на языке системы (#713), как и остальной вывод разовых команд.
  return Command.run(command(commands, handlers), options).pipe(
    Effect.tapError(reportUnrendered),
    Effect.provide(CliOutput.layer(Output.formatter(t, n))),
    Effect.provide(CliConfig.layer({ builtIns: builtIns(commands, t, () => process.argv.slice(2)) })),
  ) as Effect.Effect<void, unknown, Command.Environment>
}

/** Встроенные общие флаги effect/cli; `--wizard` — свой, мастер на языке человека. */
export function builtIns(commands: Spec.Any, translate: BuffI18n.T, args: () => ReadonlyArray<string>) {
  return [
    GlobalFlag.Help,
    GlobalFlag.Version,
    Wizard.flag(commands, translate, args),
    GlobalFlag.Completions,
    GlobalFlag.LogLevel,
  ] as unknown as ReadonlyArray<GlobalFlag.BuiltIn>
}

/**
 * Ошибку значения общего флага (`--log-level`, `--completions`) effect/cli не показывает сам —
 * она доходила до среды запуска и печаталась по-английски со стеком. Показать её, как прочие
 * ошибки разбора; справку (ShowHelp) и ошибки команд (UserError) effect/cli уже показал.
 */
function reportUnrendered(error: unknown) {
  if (!CliError.isCliError(error) || error._tag === "ShowHelp" || error._tag === "UserError") return Effect.void
  return Effect.gen(function* () {
    const formatter = yield* CliOutput.Formatter
    yield* Console.error(formatter.formatErrors([error]))
    Object.assign(error, { [Runtime.errorReported]: false })
  })
}

function provide(node: Spec.Any, handlers: ReadonlyArray<LazyHandler>): ProvidedCommand {
  const handler = handlers.find((handler) => handler.spec === node.spec)
  const spec = handler
    ? node.spec.pipe(
        Command.withHandler((input) =>
          Effect.gen(function* () {
            if (yield* PrintLogs) process.env.OPENCODE_PRINT_LOGS = "1"
            const module = yield* Effect.promise(handler.load)
            return yield* module.default(input)
          }),
        ),
      )
    : node.spec
  if (!Object.keys(node.commands).length) return spec as ProvidedCommand
  const children = Object.values(node.commands)
  return spec.pipe(
    Command.withSubcommands([
      ...children.map((child) => provide(child, handlers)),
      ...children.flatMap((child) => child.aliases.map((alias) => provide(alias, handlers))),
    ]),
  ) as ProvidedCommand
}

export * as Runtime from "./runtime"
