export * as BuffProvider from "./buff-provider.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"
import { SessionError } from "./session-error.js"

/**
 * Свои OpenAI-совместимые провайдеры из интерфейса (#562): LiteLLM, vLLM, Ollama и любой
 * сервер с `/v1/chat/completions`. Запись живёт в файле конфигурации пользователя (секция
 * `providers`), ключ — в хранилище ключей, не в файле. И проверка модели любого провайдера
 * коротким запросом. Хранит и проверяет ядро (`core/src/buff/provider.ts`).
 */

/** Пакет, через который ядро говорит с OpenAI-совместимым сервером. */
export const PACKAGE = "@opencode/ai/providers/openai-compatible"

/** Заготовки формы: LiteLLM и любой другой OpenAI-совместимый сервер. */
export const PRESETS = {
  litellm: { id: "litellm", name: "LiteLLM", baseURL: "http://localhost:4000/v1" },
  custom: { id: "", name: "", baseURL: "" },
} as const
export type Preset = keyof typeof PRESETS

/** A model of one's own provider: its id, its name, and what it reads and writes (#27) —
 *  `images`: it sees pictures; `draws`: it answers with them. Unset — text only. */
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Boolean),
  draws: Schema.optional(Schema.Boolean),
})
export type Model = typeof Model.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  baseURL: Schema.String,
  models: Schema.Array(Model),
  /** Ключ сохранён (сам ключ наружу не отдаётся). */
  hasKey: Schema.Boolean,
})
export type Entry = typeof Entry.Type

export const Draft = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  baseURL: Schema.String,
  models: Schema.Array(Model),
  /** Новый ключ; без него остаётся прежний. */
  key: Schema.optional(Schema.String),
})
export type Draft = typeof Draft.Type

/** Отказ провайдера в тех же полях, что и отказ хода, — чтобы прочитать его теми же словами. */
const Failure = Schema.Struct({ error: SessionError.Error })

/** What a server says a model reads and writes (#27), when its list says it. */
export const Modalities = Schema.Struct({ images: Schema.Boolean, draws: Schema.Boolean })
export type Modalities = typeof Modalities.Type

export const Discovered = Schema.Union([
  Schema.Struct({
    models: Schema.Array(Schema.String),
    /** Per model, where the server's list states it; a model not here — the person says. */
    modalities: Schema.optional(Schema.Record(Schema.String, Modalities)),
  }),
  Failure,
])
export type Discovered = typeof Discovered.Type

export const Checked = Schema.Union([Schema.Struct({ ms: Schema.Number, text: Schema.String }), Failure])
export type Checked = typeof Checked.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))

export const Rpc = define({
  id: "buff.provider",
  methods: {
    list: { input: Nothing, output: portable(Schema.Array(Entry)) },
    /** Модели сервера по `/models`; без ключа — ключ уже сохранённого провайдера `id`. */
    models: {
      input: portable(
        Schema.Struct({
          baseURL: Schema.String,
          key: Schema.optional(Schema.String),
          id: Schema.optional(Schema.String),
        }),
      ),
      output: portable(Discovered),
    },
    save: { input: portable(Draft), output: Nothing, errors: { invalid: Reason, unwritable: Reason } },
    remove: { input: portable(Schema.Struct({ id: Schema.String })), output: Nothing, errors: { unwritable: Reason } },
    /** Проверить модель любого подключённого провайдера коротким запросом. */
    test: {
      input: portable(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
      output: portable(Checked),
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

/** Идентификатор из названия: «My LiteLLM» → «my-litellm». */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Что не так с формой — одинаково в окне и в ядре; `undefined` — можно сохранять. */
export function draftProblem(draft: Draft, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(draft.id))
    return t("The provider ID is lowercase Latin letters, digits, hyphen or underscore.")
  if (draft.id === "buff") return t("The ID «buff» belongs to Buff models — choose another.")
  if (!draft.name.trim()) return t("Enter the provider name.")
  if (!/^https?:\/\/\S+$/.test(draft.baseURL.trim())) return t("The address must start with http:// or https://.")
  if (!draft.models.some((model) => model.id.trim())) return t("Add at least one model.")
  return undefined
}
