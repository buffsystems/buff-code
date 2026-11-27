export * as BuffChatPluginTools from "./chat-plugin-tools.js"

import path from "node:path"
import { Effect, Schema } from "effect"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { BuffSetup } from "@opencode/schema/buff-setup"
import type { FSUtil } from "@opencode/util/fs-util"
import { Permission } from "../permission.js"
import type { BuffChatPluginTests } from "./chat-plugin-tests.js"
import { BuffLocale } from "./locale.js"
import authorText from "./chat-plugin/prompts/author.md" with { type: "text" }
import guideText from "./chat-plugin/prompts/tool-guide.md" with { type: "text" }
import listText from "./chat-plugin/prompts/tool-list.md" with { type: "text" }
import removeText from "./chat-plugin/prompts/tool-remove.md" with { type: "text" }
import saveText from "./chat-plugin/prompts/tool-save.md" with { type: "text" }
import testText from "./chat-plugin/prompts/tool-test.md" with { type: "text" }

/**
 * Инструменты режима «Настройка» для плагинов чатов (#595, #984): модель сама пишет плагин,
 * проверяет его живой отрисовкой у человека и убирает. Сохранение и удаление подтверждает
 * человек; где плагин лежит, решает место разговора, а не модель.
 */

/** Описания инструментов и справочник автора — из файлов-шаблонов; наружу для тестов. */
export const descriptions = {
  guide: guideText,
  list: listText,
  save: saveText,
  test: testText,
  remove: removeText,
  author: authorText,
} as const

/** Сколько ждать, пока приложение человека нарисует примеры. */
const TEST_WAIT_MS = 25_000

const Id = Schema.String.annotate({ description: "The plugin's id" })
export const SaveInput = Schema.Struct({
  id: Id,
  name: Schema.String.annotate({ description: "The plugin's name for the user" }),
  description: Schema.String.annotate({ description: "When the visual is needed" }),
  blocks: Schema.Array(Schema.String).annotate({ description: "Names of the code blocks it draws" }),
  view: Schema.String.annotate({ description: "The whole page fragment that draws the block" }),
  guide: Schema.String.annotate({ description: "How a model writes the block" }),
  text: Schema.String.annotate({ description: "The console script, or empty" }),
  examples: Schema.Array(
    Schema.Struct({
      name: Schema.String.annotate({ description: "The example's name" }),
      block: Schema.String.annotate({ description: "The whole fenced code block" }),
    }),
  ).annotate({ description: "One to three example blocks" }),
  references: Schema.Array(
    Schema.Struct({
      name: Schema.String.annotate({ description: "The reference's file name, without .md" }),
      text: Schema.String.annotate({ description: "The reference, markdown" }),
    }),
  ).annotate({ description: "Reference files the guide points to; empty for a small plugin" }),
})
export const TargetInput = Schema.Struct({ id: Id })
const Text = Schema.Struct({ text: Schema.String })

/** Сохранение и удаление подтверждает человек всегда; запрет остаётся запретом. */
export function confirmed(event: { readonly action: string; readonly effect: "allow" | "deny" | "ask" }) {
  const ours = event.action === BuffChatPlugin.SAVE_ACTION || event.action === BuffChatPlugin.REMOVE_ACTION
  return ours && event.effect === "allow" ? "ask" : event.effect
}

/** Список плагинов словами для модели. */
export function listed(entries: readonly BuffChatPlugin.Entry[]): string {
  if (!entries.length) return "There are no chat plugins yet."
  const where = { builtin: "built in", user: "all projects", local: "this project only" } as const
  return entries
    .map((entry) => {
      const state = entry.problem ? `BROKEN — ${entry.problem}` : entry.enabled ? "on" : "switched off by the user"
      return `- ${entry.id} — «${entry.name}», blocks: ${entry.blocks.join(", ") || "none"}; ${where[entry.origin]}; ${state}. ${entry.description}`
    })
    .join("\n")
}

/** Прочитанный плагин, как его знает хранилище. */
export interface Known {
  readonly entry: BuffChatPlugin.Entry
  readonly files: Readonly<Record<string, string>>
  readonly directory?: string | undefined
}

export interface Deps {
  readonly fs: FSUtil.Interface
  readonly all: Effect.Effect<readonly Known[]>
  /** Каталоги областей: пользователя и личной папки проекта (её может не быть). */
  readonly roots: { readonly user: string; readonly local?: string | undefined }
  /** Название проекта — для подтверждения «только в этом проекте». */
  readonly project: string
  readonly enable: (id: string) => Effect.Effect<void>
  readonly changed: Effect.Effect<void>
  readonly desk: BuffChatPluginTests.Desk
  /** Срок ожидания живой проверки; тесты ставят короткий. */
  readonly testWait?: number
}

type Call = {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly progress: (update: Record<string, unknown>) => Effect.Effect<void>
}

const fail = (message: string) => Effect.fail(new ToolFailure({ message }))

export const register = Effect.fn("BuffChatPluginTools.register")(function* (ctx: Context, deps: Deps) {
  const permission = yield* Permission.Service
  const { fs } = deps

  yield* ctx.permission.hook("evaluate", (event) =>
    Effect.sync(() => {
      event.effect = confirmed(event)
    }),
  )

  const ask = (call: Call, action: string, resources: string[], metadata: Record<string, unknown>) =>
    permission
      .assert({
        action,
        resources,
        metadata,
        sessionID: call.sessionID as never,
        agent: call.agent as never,
        source: { type: "tool", messageID: call.messageID as never, id: call.id as never },
      })
      .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied", error })))
  const known = (id: string) =>
    deps.all.pipe(
      Effect.flatMap((plugins) => {
        const found = plugins.find((item) => item.entry.id === id)
        return found ? Effect.succeed(found) : fail(`No chat plugin «${id}». Call ${BuffChatPlugin.TOOLS.list}.`)
      }),
    )
  const unwritable = (cause: { readonly message: string }) =>
    new ToolFailure({ message: `Could not write the plugin's files: ${cause.message}` })

  const save = (input: typeof SaveInput.Type, call: Call) =>
    Effect.gen(function* () {
      const folder = BuffChatPlugin.folderOf(input)
      if ("problem" in folder) return yield* fail(folder.problem)
      const plugins = yield* deps.all
      const existing = plugins.find((item) => item.entry.id === input.id)
      if (existing?.entry.origin === "builtin")
        return yield* fail(`«${input.id}» is a built-in plugin's id: choose another id.`)
      const taken = BuffChatPlugin.owners(
        plugins.filter((item) => item.entry.id !== input.id).map((item) => item.entry),
      )
      const clash = input.blocks.find((block) => taken[block] !== undefined)
      if (clash)
        return yield* fail(
          `The block «${clash}» is already drawn by the plugin «${taken[clash]}»: choose another block name, or change that plugin.`,
        )
      // Существующий плагин остаётся где был; новый — в проекте только для него, вне проекта для всех.
      const scope: BuffChatPlugin.Scope =
        existing?.entry.origin === "user" ? "user" : existing || deps.roots.local ? "local" : "user"
      const root = scope === "local" && deps.roots.local ? deps.roots.local : deps.roots.user
      const directory = existing?.directory ?? path.join(root, BuffChatPlugin.DIR, input.id)
      yield* ask(
        call,
        BuffChatPlugin.SAVE_ACTION,
        BuffChatPlugin.saveConfirmation(
          { name: input.name, description: input.description, blocks: input.blocks, scope, project: deps.project },
          BuffLocale.t,
        ),
        { id: input.id, scope, blocks: [...input.blocks] },
      )
      // Прежние примеры и текст для консоли, которых в новой версии нет, не остаются.
      yield* fs.remove(directory, { recursive: true, force: true }).pipe(Effect.mapError(unwritable))
      for (const [name, text] of Object.entries(folder.files))
        yield* fs.writeWithDirs(path.join(directory, name), text).pipe(Effect.mapError(unwritable))
      yield* deps.enable(input.id)
      yield* deps.changed
      const addresses = BuffChatPlugin.webAddresses(input.view)
      return [
        `Saved for ${scope === "local" ? `this project only («${deps.project}»)` : "all projects"}.`,
        `Folder: ${directory} — edit its files there to improve the plugin.`,
        ...(addresses.length
          ? [
              `Warning: the view names web addresses that will never load (the frame has no network): ${addresses.join(", ")}. Put what it needs inline.`,
            ]
          : []),
        `Now run ${BuffChatPlugin.TOOLS.test}.`,
      ].join("\n")
    })

  const test = (input: typeof TargetInput.Type, call: Call) =>
    Effect.gen(function* () {
      const plugin = yield* known(input.id)
      if (plugin.entry.problem) return `The plugin's files have a problem: ${plugin.entry.problem}`
      const examples = plugin.entry.examples.flatMap((name) => {
        const file = plugin.files[`${BuffChatPlugin.FILES.examples}/${name}.md`]
        const fenced = file === undefined ? undefined : BuffChatPlugin.exampleOf(file)
        return fenced ? [{ name, ...fenced }] : []
      })
      if (!examples.length)
        return `The plugin has no example to draw: add one with ${BuffChatPlugin.TOOLS.save} (a fenced code block, as in a chat).`
      const addresses = BuffChatPlugin.webAddresses(plugin.files[BuffChatPlugin.FILES.view] ?? "")
      const task: BuffChatPlugin.Test = {
        id: plugin.entry.id,
        version: plugin.entry.version,
        name: plugin.entry.name,
        examples,
      }
      const waiting = deps.desk.wait(
        `${call.sessionID}:${call.id}`,
        examples.map((example) => example.name),
        deps.testWait ?? TEST_WAIT_MS,
        task,
      )
      // Задание — в метаданные идущего вызова: его видит клиент, который показывает этот чат.
      yield* call.progress({ [BuffChatPlugin.TEST_KEY]: task })
      const results = yield* Effect.promise(() => waiting)
      return [
        ...(addresses.length
          ? [`Warning: the view names web addresses that will never load: ${addresses.join(", ")}.`, ""]
          : []),
        BuffChatPlugin.testText(
          examples.map((example) => example.name),
          results,
        ),
      ].join("\n")
    })

  const remove = (input: typeof TargetInput.Type, call: Call) =>
    Effect.gen(function* () {
      const plugin = yield* known(input.id)
      if (plugin.entry.origin === "builtin" || !plugin.directory)
        return yield* fail(
          `«${input.id}» is built in: it cannot be removed. The user can switch it off in the settings.`,
        )
      yield* ask(
        call,
        BuffChatPlugin.REMOVE_ACTION,
        [BuffLocale.t("Remove the chat plugin «{name}»", { name: plugin.entry.name })],
        { id: input.id },
      )
      yield* fs
        .remove(plugin.directory, { recursive: true, force: true })
        .pipe(Effect.mapError((cause) => new ToolFailure({ message: `Could not delete the plugin: ${cause.message}` })))
      yield* deps.changed
      return `Removed «${plugin.entry.name}»: its blocks are plain code again.`
    })

  const list = () => deps.all.pipe(Effect.map((plugins) => listed(plugins.map((item) => item.entry))))

  const add = <I extends Schema.Codec<any, any>>(
    name: string,
    description: string,
    input: I,
    run: (input: Schema.Schema.Type<I>, call: Call) => Effect.Effect<string, ToolFailure>,
  ) =>
    ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description.trim(),
          input,
          output: Text,
          execute: (value, context) =>
            (context.agent === BuffSetup.AGENT
              ? Effect.void
              : fail("Chat plugins are made and changed only in Self-setup mode. Offer the user to open it.")
            ).pipe(
              // Тип входа инструмента выводится из схемы иначе, чем `Schema.Type`, но это одно и то же значение.
              Effect.andThen(run(value as Schema.Schema.Type<I>, context as unknown as Call)),
              Effect.map((text) => ({ output: { text }, content: text, metadata: {} })),
            ),
        }),
      )
      .pipe(Effect.orDie)

  yield* add(BuffChatPlugin.TOOLS.guide, guideText, Schema.Struct({}), () => Effect.succeed(authorText.trim()))
  yield* add(BuffChatPlugin.TOOLS.list, listText, Schema.Struct({}), list)
  yield* add(BuffChatPlugin.TOOLS.save, saveText, SaveInput, save)
  yield* add(BuffChatPlugin.TOOLS.test, testText, TargetInput, test)
  yield* add(BuffChatPlugin.TOOLS.remove, removeText, TargetInput, remove)

  return { save, test, remove, list }
})
