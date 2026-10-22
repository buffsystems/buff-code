export * as BuffProviderFile from "./provider-file.js"

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { BuffProvider } from "@opencode/schema/buff-provider"
import { BuffLocale } from "./locale.js"

/**
 * Свои OpenAI-совместимые провайдеры в файле конфигурации (#562): текст на входе, текст на
 * выходе. Правится только запись провайдера — комментарии, другие настройки и то, что человек
 * дописал в запись руками (заголовки, лимиты моделей), остаются. Ключа в файле нет.
 */
const FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }
const BROKEN = "The configuration file cannot be read: it has a markup error. Fix it by hand."

type Raw = Record<string, unknown>
const record = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)

function document(text: string): Raw {
  if (!text.trim()) return {}
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !record(parsed)) throw new Error(BuffLocale.t(BROKEN))
  return parsed
}

/** Свои провайдеры файла: записи `providers` с адресом сервера. */
export function providers(text: string): Omit<BuffProvider.Entry, "hasKey">[] {
  const section = document(text).providers
  if (!record(section)) return []
  return Object.entries(section).flatMap(([id, raw]) => {
    if (!record(raw) || !record(raw.settings) || typeof raw.settings.baseURL !== "string") return []
    const models = record(raw.models) ? raw.models : {}
    return [
      {
        id,
        name: typeof raw.name === "string" ? raw.name : id,
        baseURL: raw.settings.baseURL,
        models: Object.entries(models).map(([model, config]) =>
          record(config) && typeof config.name === "string" ? { id: model, name: config.name } : { id: model },
        ),
      },
    ]
  })
}

/** Записать провайдера (`undefined` — убрать). Прежние настройки записи и её моделей сохраняются. */
export function withProvider(
  text: string,
  id: string,
  draft: Omit<BuffProvider.Draft, "id" | "key"> | undefined,
): string {
  const section = document(text).providers
  const before = record(section) && record(section[id]) ? section[id] : undefined
  const base = text.trim() ? text : "{}\n"
  if (!draft && !before) return text
  const next = draft && {
    ...before,
    name: draft.name.trim(),
    package: BuffProvider.PACKAGE,
    settings: {
      ...(record(before?.settings) ? before.settings : {}),
      baseURL: draft.baseURL.trim().replace(/\/+$/, ""),
    },
    models: Object.fromEntries(
      draft.models
        .filter((model) => model.id.trim())
        .map((model) => {
          const kept = (record(before?.models) && record(before.models[model.id]) ? before.models[model.id] : {}) as Raw
          const name = model.name?.trim()
          // Свой сервер не обязан знать `store` (LiteLLM перед Anthropic отказывает на нём);
          // совместимость, заданную руками, не трогаем.
          return [model.id.trim(), { compatibility: { supportsStore: false }, ...kept, ...(name ? { name } : {}) }]
        }),
    ),
  }
  const edited = applyEdits(base, modify(base, ["providers", id], next, FORMAT))
  return edited.endsWith("\n") ? edited : `${edited}\n`
}
