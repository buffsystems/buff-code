export * as BuffSetupFormPlugin from "./setup-form.js"

import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffSecret } from "@opencode/schema/buff-secret"
import { BuffSetup } from "@opencode/schema/buff-setup"
import type { Form as FormSchema } from "@opencode/schema/form"
import { Form } from "../form.js"
import { Permission } from "../permission.js"
import { QuestionTool } from "../tool/plugin/question.js"
import descriptionText from "./setup/prompts/setup-form.md" with { type: "text" }

/**
 * Форма режима «Настройка» (#765): модель описывает поля простыми словами — адрес, логин, путь,
 * выбор, секрет — человек заполняет в окне, консоли или на телефоне. Секретное поле модель не
 * читает: в ответе на его месте ссылка `secret:<id>`, которую она ставит в настройки подключения
 * как `{secret:<id>}`. Названий сервисов здесь нет: поля описывает модель под каждый случай.
 */

export const TOOL = "setup_form"
export const description = descriptionText.trim()

const Option = Schema.Struct({
  value: Schema.String.annotate({ description: "Value you receive back" }),
  label: Schema.String.annotate({ description: "What the user sees, in their language" }),
  hint: Schema.String.pipe(Schema.optional).annotate({ description: "One short line under the label" }),
})

export const FieldInput = Schema.Struct({
  key: Schema.String.annotate({ description: "Your name for the answer, Latin letters, unique in the form" }),
  label: Schema.String.annotate({ description: "What is asked, in the user's words" }),
  hint: Schema.String.pipe(Schema.optional).annotate({ description: "Where to find it or what it looks like" }),
  kind: Schema.Literals(["text", "secret", "choice", "multi", "yesno", "number", "link"]).annotate({
    description:
      "text — any value you may read; secret — password, key or token: you receive a reference, never the value; choice — one of options; multi — several of options; yesno — a switch; number — a number; link — an address the user must open (url), acknowledged",
  }),
  required: Schema.Boolean.annotate({ description: "false when the user may leave it empty" }),
  options: Schema.Array(Option).pipe(Schema.optional).annotate({ description: "For choice and multi" }),
  custom: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "For choice and multi: true lets the user type their own answer besides the options",
  }),
  placeholder: Schema.String.pipe(Schema.optional).annotate({ description: "Example value, for text and secret" }),
  url: Schema.String.pipe(Schema.optional).annotate({ description: "For link only" }),
})
export type FieldInput = typeof FieldInput.Type

export const Input = Schema.Struct({
  title: Schema.String.annotate({ description: "Short title of the form, in the user's language" }),
  note: Schema.String.annotate({ description: "One or two plain sentences on why you ask; empty if obvious" }),
  fields: Schema.Array(FieldInput).check(Schema.isNonEmpty()),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({ answers: Schema.Record(Schema.String, Schema.Unknown) })

/** Поля формы из описания модели, или почему форму не показать. */
export function fields(input: Input): FormSchema.Fields | { error: string } {
  const keys = new Set<string>()
  const out: FormSchema.Field[] = []
  for (const field of input.fields) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key))
      return { error: `Field key must be a Latin identifier: ${field.key}` }
    if (keys.has(field.key)) return { error: `Duplicate field key: ${field.key}` }
    keys.add(field.key)
    const base = { key: field.key, title: field.label, ...(field.hint ? { description: field.hint } : {}) }
    if (field.kind === "link") {
      if (!field.url || !URL.canParse(field.url)) return { error: `A link field needs a valid url: ${field.key}` }
      out.push({ ...base, type: "external", url: field.url })
      continue
    }
    if (field.kind === "choice" || field.kind === "multi") {
      if (!field.options?.length) return { error: `A ${field.kind} field needs options: ${field.key}` }
      out.push({
        ...base,
        type: field.kind === "multi" ? "multiselect" : "string",
        required: field.required,
        options: field.options.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.hint ? { description: option.hint } : {}),
        })),
        ...(field.custom ? { custom: true } : {}),
      })
      continue
    }
    if (field.kind === "yesno") {
      out.push({ ...base, type: "boolean", required: field.required })
      continue
    }
    if (field.kind === "number") {
      out.push({ ...base, type: "number", required: field.required })
      continue
    }
    out.push({
      ...base,
      type: field.kind === "secret" ? "secret" : "string",
      required: field.required,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    })
  }
  return out as unknown as FormSchema.Fields
}

/** Что слышит модель: ответы по ключам; секрет — ссылкой и напоминанием, как её применить. */
export function reply(input: Input, answer: FormSchema.Answer): string {
  const lines = input.fields.map((field) => {
    const value = answer[field.key]
    if (field.kind === "link") return `${field.key}: opened`
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
      return `${field.key}: (empty)`
    if (field.kind === "secret")
      return `${field.key}: ${String(value)} — a reference; put ${BuffSecret.token(BuffSecret.idOf(String(value)))} where the connection needs the value`
    return `${field.key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`
  })
  return `The user filled in «${input.title}»:\n${lines.join("\n")}`
}

export const Plugin = define<Form.Service | Permission.Service | Scope.Scope>({
  id: "buff.setup-form",
  effect: Effect.fn(function* (ctx) {
    const forms = yield* Form.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: TOOL,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (context.agent !== BuffSetup.AGENT)
                return yield* Effect.fail(new ToolFailure({ message: "setup_form is only for Setup mode." }))
              const built = fields(input)
              if ("error" in built) return yield* Effect.fail(new ToolFailure({ message: built.error }))
              yield* permission
                .assert({
                  action: "question",
                  resources: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })))
              const state = yield* forms
                .ask({
                  sessionID: context.sessionID,
                  title: input.title,
                  metadata: {
                    kind: "setup",
                    note: input.note,
                    tool: { messageID: context.messageID, id: context.id },
                  },
                  fields: built,
                })
                .pipe(Effect.orDie)
              // Закрытая форма — тот же отказ, что у вопроса: ход прерывается без слов модели.
              if (state.status === "cancelled") return yield* Effect.die(new QuestionTool.CancelledError())
              return {
                output: { answers: state.answer },
                content: reply(input, state.answer),
                metadata: { answers: state.answer },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
})
