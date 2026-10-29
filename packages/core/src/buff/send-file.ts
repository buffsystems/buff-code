export * as BuffSendFilePlugin from "./send-file.js"

import * as fs from "node:fs"
import * as path from "node:path"
import { Effect, Schema } from "effect"
import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffSendFile } from "@opencode/schema/buff-send-file"
import { BuffLocale } from "./locale.js"
import descriptionText from "./prompts/send-file.md" with { type: "text" }

/**
 * Файл от агента человеку (#708), как `send_file` в «Спросить»: файл из папки сессии уходит в её
 * ленту карточкой — окно открывает его, телефон показывает или отдаёт системе. Модели — только
 * подтверждение: содержимое документа ей не нужно и не всякой модели по силам.
 */

export const description = descriptionText.trim()

const Input = Schema.Struct({
  path: Schema.String.annotate({ description: "The file, relative to the working folder or absolute inside it." }),
  note: Schema.String.annotate({ description: "One short line on what the file is; empty if the name says it." }),
})

const Output = Schema.Struct({ file: Schema.String })

const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep)

/** Файл `wanted` папки `directory` для человека, или почему его не отдать. */
export function handOver(directory: string, wanted: string, note: string): BuffSendFile.Sent | { error: string } {
  const root = fs.realpathSync(directory)
  const asked = path.resolve(root, wanted.trim())
  if (!inside(root, asked)) return { error: BuffLocale.t("Only a file inside the working folder can be sent.") }
  if (!fs.existsSync(asked)) return { error: BuffLocale.t("No such file: {file}", { file: wanted }) }
  // Ссылка из папки наружу — тот же выход за папку.
  const real = fs.realpathSync(asked)
  if (!inside(root, real)) return { error: BuffLocale.t("Only a file inside the working folder can be sent.") }
  const stat = fs.statSync(real)
  if (!stat.isFile()) return { error: BuffLocale.t("Only a file can be sent, not a folder.") }
  if (stat.size > BuffSendFile.MAX_BYTES) return { error: BuffLocale.t("The file is larger than 20 MB") }
  const name = path.basename(real)
  return {
    file: path.relative(root, real).split(path.sep).join("/"),
    name,
    mime: BuffSendFile.mimeOf(name),
    bytes: stat.size,
    note: note.trim() || undefined,
  }
}

export function reply(sent: BuffSendFile.Sent): string {
  return `Sent to the user: ${sent.file} (${sent.bytes} bytes). They see it as a file card in the conversation.`
}

export const Plugin = define({
  id: "buff.send-file",
  effect: Effect.fn(function* (ctx) {
    const directory = ctx.location.directory
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: BuffSendFile.TOOL,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) => {
            const sent = handOver(directory, input.path, input.note)
            if ("error" in sent) return Effect.fail(new ToolFailure({ message: sent.error }))
            return Effect.succeed({ output: { file: sent.file }, content: reply(sent), metadata: { sent } })
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
})
