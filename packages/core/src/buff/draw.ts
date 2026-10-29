export * as BuffDraw from "./draw.js"

import { Duration, Effect, Schedule, Schema, Stream } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { BuffContext } from "@opencode/schema/buff-context"
import { BuffLocale } from "./locale.js"
import { BuffModels } from "./models.js"

/**
 * Картинка по просьбе (#27): инструмент `draw_image` рисует моделью-художником организации —
 * через коннектор (`/v1/draw`), на ключе организации, как любой вызов модели, — и кладёт файл в
 * рабочую папку сессии. Картинка сразу показывается в чате, видящая модель её тоже видит.
 */

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }

/** Файл картинки `mime` под именем `wanted` в папке `dir`; null — имя уводит из папки. */
export function pictureFile(dir: string, wanted: string, mime: string): string | null {
  const root = path.resolve(dir)
  const base = path.basename(String(wanted || "").trim()).replace(/\.(png|jpe?g|webp|gif)$/i, "") || "picture"
  if (base === "." || base === "..") return null
  const file = path.resolve(root, `${base}${EXT[mime] ?? ".png"}`)
  return file.startsWith(root + path.sep) ? file : null
}

/** Ответ коннектора → картинка или причина отказа его словами. */
export function drawn(reply: unknown): { mime: string; content: string } | { error: string } {
  const r = (reply ?? {}) as { content?: unknown; mime?: unknown; error?: unknown }
  if (typeof r.content === "string" && r.content) return { mime: typeof r.mime === "string" ? r.mime : "image/png", content: r.content }
  const e = r.error as { message?: unknown } | string | undefined
  const message = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : ""
  return { error: message || BuffLocale.t("The picture was not drawn.") }
}

export const description =
  "Draw a picture with the organisation's painter model and save it as a file in the working folder. " +
  "Call it when asked to draw, depict or generate a picture, illustration, logo, mock-up or icon — something " +
  "code does not build; a chart from data, a scheme or a diagram is more reliable made with code.\n" +
  "prompt — a detailed description (subject, style, colours, any text on it); file — a file name without a path. " +
  "Returns the path and the picture itself. Every drawing is a paid model call: draw only when a picture is asked for."

const Input = Schema.Struct({ prompt: Schema.String, file: Schema.String })

/** How often the sign-in is looked at again, besides its own events. */
const RECHECK = Duration.minutes(4)

export const register = Effect.fn("BuffDraw.register")(function* (
  ctx: Context,
  deps: {
    readonly signedIn: Effect.Effect<BuffModels.SignedIn | undefined>
    readonly choice: Effect.Effect<BuffContext.Choice | null>
  },
) {
  const directory = ctx.location.directory
  // Offered only to a person signed into Buff: a run of the pipeline or «Спросить» draws with
  // its own server-side tool, and a second one there would only confuse the model.
  let offered = false
  yield* ctx.tool
    .transform((editor) => {
      if (!offered) return
      editor.add({
        name: "draw_image",
        description,
        input: Input,
        output: Schema.Struct({ file: Schema.String }),
        options: { codemode: false },
        execute: (input, context) =>
          Effect.gen(function* () {
            const me = yield* deps.signedIn
            const choice = yield* deps.choice
            if (!me || !choice)
              return yield* Effect.fail(new ToolFailure({ message: BuffLocale.t("A Buff organisation draws: sign in and choose it.") }))
            const reply = yield* Effect.promise(() =>
              fetch(`${me.connector}/v1/draw`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${me.token}`,
                  "Content-Type": "application/json",
                  ...BuffModels.requestHeaders(choice, context.sessionID, "draw", context.messageID),
                },
                body: JSON.stringify({ prompt: input.prompt }),
              })
                .then((res) => res.json())
                .catch((cause: unknown) => ({ error: BuffLocale.t("The connector did not answer: {cause}", { cause: String(cause) }) })),
            )
            const picture = drawn(reply)
            if ("error" in picture) return yield* Effect.fail(new ToolFailure({ message: picture.error }))
            const file = pictureFile(directory, input.file, picture.mime)
            if (!file) return yield* Effect.fail(new ToolFailure({ message: BuffLocale.t("The file name must be plain, without a path.") }))
            const bytes = Buffer.from(picture.content, "base64")
            fs.writeFileSync(file, bytes)
            return {
              output: { file },
              // Карточка файла в ленте (#708): телефон показывает картинку по ней — сама картинка в
              // выводе слишком велика для кадра до телефона.
              metadata: {
                sent: { file: path.relative(directory, file), name: path.basename(file), mime: picture.mime, bytes: bytes.length },
              },
              content: [
                { type: "text" as const, text: BuffLocale.t("Picture saved: {file}", { file: path.relative(directory, file) }) },
                { type: "file" as const, uri: `data:${picture.mime};base64,${picture.content}`, mime: picture.mime, name: path.basename(file) },
              ],
            }
          }),
      })
    })
    .pipe(Effect.orDie)

  const recheck = Effect.gen(function* () {
    const now = !!(yield* deps.signedIn)
    if (now === offered) return
    offered = now
    yield* ctx.tool.reload()
  }).pipe(Effect.catch((cause) => Effect.logWarning("Buff: drawing is unavailable", { cause })))
  yield* ctx.event.subscribe().pipe(
    Stream.filter(
      (event) =>
        (event.type === "credential.switched" || event.type === "credential.updated") &&
        (event.data as { integrationID?: string } | undefined)?.integrationID === "buff",
    ),
    Stream.runForEach(() => recheck),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* recheck.pipe(Effect.repeat(Schedule.spaced(RECHECK)), Effect.forkScoped)
})
