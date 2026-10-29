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

/** Что модель читает и пишет, по `capabilities` в файле (#27): картинки на входе и на выходе. */
function flags(config: Raw): Pick<BuffProvider.Model, "images" | "draws"> {
  const caps = record(config.capabilities) ? config.capabilities : undefined
  if (!caps) return {}
  const has = (list: unknown) => Array.isArray(list) && list.includes("image")
  return { images: has(caps.input), draws: has(caps.output) }
}

/** What a server's model list says a model reads and writes (#27): OpenRouter's
 *  `architecture.input_modalities`/`output_modalities` (or the same at the top level), LiteLLM's
 *  `supports_vision`. null — the list says nothing, the person decides. */
export function listedModalities(item: unknown): BuffProvider.Modalities | null {
  if (!record(item)) return null
  const arch = record(item.architecture) ? item.architecture : item
  const input = arch.input_modalities
  const output = arch.output_modalities
  if (Array.isArray(input) || Array.isArray(output))
    return {
      images: Array.isArray(input) && input.includes("image"),
      draws: Array.isArray(output) && output.includes("image"),
    }
  const info = record(item.model_info) ? item.model_info : item
  if (typeof info.supports_vision === "boolean") return { images: info.supports_vision, draws: false }
  return null
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
          record(config)
            ? { id: model, ...(typeof config.name === "string" ? { name: config.name } : {}), ...flags(config) }
            : { id: model },
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
          // Что модель читает и пишет (#27), когда это сказано: картинка уйдёт только видящей.
          const capabilities =
            model.images === undefined && model.draws === undefined
              ? {}
              : {
                  capabilities: {
                    tools: true,
                    input: ["text", ...(model.images ? ["image"] : [])],
                    output: ["text", ...(model.draws ? ["image"] : [])],
                  },
                }
          // Свой сервер не обязан знать `store` (LiteLLM перед Anthropic отказывает на нём);
          // совместимость, заданную руками, не трогаем.
          return [
            model.id.trim(),
            { compatibility: { supportsStore: false }, ...kept, ...(name ? { name } : {}), ...capabilities },
          ]
        }),
    ),
  }
  const edited = applyEdits(base, modify(base, ["providers", id], next, FORMAT))
  return edited.endsWith("\n") ? edited : `${edited}\n`
}
