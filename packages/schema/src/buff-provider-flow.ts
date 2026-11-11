export * as BuffProviderFlow from "./buff-provider-flow.js"

import { BuffContextWindow } from "./buff-context-window.js"
import { BuffI18n } from "./buff-i18n.js"
import { BuffProvider } from "./buff-provider.js"
import { turnFailure } from "./buff-turn-failure.js"

/**
 * Свой OpenAI-совместимый сервер из консоли (#562): те же поля, что в окне, — вопросами по
 * очереди. Диалоги и запрос моделей приходят снаружи, так что шаги проверяются без терминала.
 * `undefined` — человек вышел из вопроса; `problem` — сохранять нечего.
 */

interface Option<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
}

export interface Ui {
  select<Value>(dialog: { title: string; options: readonly Option<Value>[] }): Promise<Value | undefined>
  prompt(dialog: {
    title: string
    description?: string
    placeholder?: string
    value?: string
  }): Promise<string | undefined>
  t?: BuffI18n.T
}

export type Problem = { readonly problem: string }
type Models = (input: { baseURL: string; key?: string }) => Promise<BuffProvider.Discovered>

/** Служебные ответы выбора моделей — не совпадают ни с одним идентификатором модели. */
export const ALL = "\u0000all"
export const MANUAL = "\u0000manual"

/** Ответ или его значение по умолчанию: пустой ответ — согласие с подсказкой. */
const or = (answer: string, fallback: string) => answer.trim() || fallback

export async function add(
  ui: Ui,
  models: Models,
  preset: BuffProvider.Preset,
): Promise<BuffProvider.Draft | Problem | undefined> {
  const t = ui.t ?? BuffI18n.english
  const start = BuffProvider.PRESETS[preset]
  const named = await ui.prompt({ title: t("Name"), placeholder: start.name || "Office vLLM", value: start.name })
  if (named === undefined) return
  const name = or(named, start.name)
  const fallbackID = start.id || BuffProvider.slug(name)
  const id = start.id
    ? start.id
    : await ui.prompt({
        title: t("Provider ID"),
        description: t("Used in model names: {id}/model.", { id: fallbackID }),
        placeholder: fallbackID,
      })
  if (id === undefined) return
  const address = await ui.prompt({
    title: t("Server address"),
    placeholder: "http://localhost:4000/v1",
    value: start.baseURL,
  })
  if (address === undefined) return
  const baseURL = or(address, start.baseURL)
  const key = await ui.prompt({
    title: t("Key"),
    description: t("Leave empty if the server needs none."),
  })
  if (key === undefined) return
  const found = await models({ baseURL, ...(key.trim() ? { key: key.trim() } : {}) })
  const listed = "models" in found ? found.models : []
  const title =
    "error" in found
      ? turnFailure(found.error, or(id, fallbackID), t, name).text
      : listed.length
        ? t("Models of {provider}", { provider: name })
        : t("The server lists no models — add them by hand.")
  const choice = await ui.select<string>({
    title,
    options: [
      ...(listed.length > 1 ? [{ title: t("All models ({n})", { n: listed.length }), value: ALL }] : []),
      ...listed.map((model) => ({ title: model, value: model })),
      { title: t("Type models by hand"), value: MANUAL },
    ],
  })
  if (choice === undefined) return
  const typed = choice === MANUAL ? await ui.prompt({ title: t("Model IDs, separated by commas") }) : ""
  if (typed === undefined) return
  const ids = (
    choice === ALL ? listed : choice === MANUAL ? typed.split(",").map((item) => item.trim()) : [choice]
  ).filter(Boolean)
  // The window (#898): what the server names is taken as it is; for the models it says nothing
  // about, one question — an empty answer leaves them without a window, and the menu says so.
  const said = ("models" in found ? found.windows : undefined) ?? {}
  const bare = ids.filter((model) => !said[model]?.context)
  const sized = bare.length
    ? await ui.prompt({
        title: t("Context window in tokens"),
        description: t("For {models}: 128k, 1M. Empty — not set, 200k is assumed.", { models: bare.join(", ") }),
        placeholder: "200k",
      })
    : ""
  if (sized === undefined) return
  const typedWindow = sized.trim() ? BuffContextWindow.parseCustom(sized, undefined) : undefined
  if (sized.trim() && !typedWindow) return { problem: t("A context window is a number of tokens: 128k, 1M.") }
  const draft: BuffProvider.Draft = {
    id: or(id, fallbackID),
    name,
    baseURL,
    models: ids.map((model) => ({
      id: model,
      ...said[model],
      ...(!said[model]?.context && typedWindow ? { context: typedWindow } : {}),
    })),
    ...(key.trim() ? { key: key.trim() } : {}),
  }
  const problem = BuffProvider.draftProblem(draft, t)
  return problem ? { problem } : draft
}

/** Итог проверки модели словами — теми же, что в окне. */
export function checked(
  result: BuffProvider.Checked,
  providerID: string,
  provider: string,
  t: BuffI18n.T = BuffI18n.english,
): { ok: boolean; text: string } {
  if ("error" in result) return { ok: false, text: turnFailure(result.error, providerID, t, provider).text }
  return {
    ok: true,
    text: t("Works: answered in {seconds} s — «{text}»", {
      seconds: (result.ms / 1000).toFixed(1),
      text: result.text.slice(0, 80) || "…",
    }),
  }
}
