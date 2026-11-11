// One's own OpenAI-compatible provider (#562): LiteLLM or any server with /v1/chat/completions.
// The address and the key, the models read from the server's /models (or typed by hand), then
// saved by the core into the user's configuration — the key into the key store, not the file.

import { Button, Callout, Checkbox, Field, Input } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { BuffProvider } from "@opencode/schema/buff-provider"
import { turnFailure } from "@opencode/schema/buff-turn-failure"
import { Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { at } from "../../buff/settings/rpc"

export function OwnProviderForm(props: {
  server: Server
  directory?: string
  preset: BuffProvider.Preset
  /** The provider being edited; without it a new one. */
  entry?: BuffProvider.Entry
  onSaved: (saved: { id: string; name: string; baseURL: string; models: readonly BuffProvider.Model[] }) => void
}) {
  const t = useI18n().buff.t
  const start = props.entry ?? BuffProvider.PRESETS[props.preset]
  const [name, setName] = useState(start.name)
  const [id, setID] = useState<string>()
  const [baseURL, setBaseURL] = useState(start.baseURL)
  const [key, setKey] = useState("")
  const [found, setFound] = useState<readonly string[]>([])
  // What the server's list says each model reads and writes (#27): a chosen model starts with it.
  const [said, setSaid] = useState<Readonly<Record<string, BuffProvider.Modalities>>>({})
  const [models, setModels] = useState<readonly BuffProvider.Model[]>(props.entry?.models ?? [])
  // What the server says of each model's size (#898), and the window as the person types it.
  const [sizes, setSizes] = useState<Readonly<Record<string, BuffProvider.Window>>>({})
  const [windows, setWindows] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      (props.entry?.models ?? []).flatMap((model) =>
        model.context ? [[model.id, BuffContextWindow.exact(model.context)]] : [],
      ),
    ),
  )
  const [typed, setTyped] = useState("")
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const providerID = props.entry?.id ?? id ?? (start.id || BuffProvider.slug(name))
  const rpc = props.server.api().rpc(BuffProvider.Rpc)

  const chosen = new Set(models.map((model) => model.id))
  const fresh = (model: string): BuffProvider.Model => ({ id: model, ...said[model], ...sizes[model] })
  const pick = (model: string) => {
    const item = fresh(model)
    setModels([...models, item])
    if (item.context) setWindows({ ...windows, [model]: BuffContextWindow.exact(item.context) })
  }
  const toggle = (model: string, on: boolean) =>
    on ? pick(model) : setModels(models.filter((item) => item.id !== model))
  /** The person's mark on a chosen model: it sees pictures, or answers with them (#27). */
  const mark = (model: string, flag: "images" | "draws", on: boolean) =>
    setModels(models.map((item) => (item.id === model ? { ...item, [flag]: on } : item)))

  /** The window typed for a model (#898): "1M", "128k", "200000"; empty takes it out. */
  const size = (model: string, text: string) => {
    setWindows({ ...windows, [model]: text })
    const context = BuffContextWindow.parseCustom(text, undefined) ?? 0
    setModels(models.map((item) => (item.id === model ? { ...item, context } : item)))
  }
  const unread = (model: string) =>
    !!windows[model]?.trim() && !BuffContextWindow.parseCustom(windows[model]!, undefined)

  const discover = async () => {
    setLoading(true)
    setProblem(undefined)
    const result = await rpc
      .models(
        { baseURL, ...(key.trim() ? { key: key.trim() } : {}), ...(props.entry ? { id: props.entry.id } : {}) },
        at(props.directory),
      )
      .catch(
        (error: unknown): BuffProvider.Discovered => ({
          error: { type: "unknown", message: formatServerError(error) },
        }),
      )
    setLoading(false)
    if ("error" in result) return setProblem(turnFailure(result.error, providerID, t, name || providerID).text)
    setFound(result.models)
    const listed = result.modalities ?? {}
    setSaid(listed)
    // The first read picks every model, with what the list says it reads; later ones keep the
    // choice and only fill in a model the person has not marked.
    // The same for the window (#898): what the server names fills a model that has none yet.
    const named = result.windows ?? {}
    setSizes(named)
    const filled = (item: BuffProvider.Model): BuffProvider.Model => ({
      ...item,
      ...(item.images === undefined ? listed[item.id] : {}),
      ...(item.context ? {} : named[item.id]),
    })
    const next = (models.length === 0 ? result.models.map((model) => ({ id: model })) : models).map(filled)
    setModels(next)
    setWindows({
      ...Object.fromEntries(
        next.flatMap((item) => (item.context ? [[item.id, BuffContextWindow.exact(item.context)]] : [])),
      ),
      ...Object.fromEntries(Object.entries(windows).filter(([, text]) => text.trim())),
    })
    if (result.models.length === 0) setProblem(t("The server lists no models — add them by hand."))
  }

  const add = () => {
    const model = typed.trim()
    if (model && !chosen.has(model)) pick(model)
    setTyped("")
  }

  const draft: BuffProvider.Draft = {
    id: providerID,
    name,
    baseURL,
    models,
    ...(key.trim() ? { key: key.trim() } : {}),
  }
  const invalid =
    BuffProvider.draftProblem(draft, t) ??
    (models.some((model) => unread(model.id)) ? t("A context window is a number of tokens: 128k, 1M.") : undefined)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (invalid || saving) return
    setSaving(true)
    setProblem(undefined)
    await rpc
      .save(draft, at(props.directory))
      .then(() => props.onSaved({ id: providerID, name: name.trim(), baseURL: baseURL.trim(), models }))
      .catch((error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))))
    setSaving(false)
  }

  const shown = [...new Set([...found, ...models.map((model) => model.id)])]
  return (
    <form className="flex flex-col gap-3" data-component="own-provider-form" onSubmit={(event) => void save(event)}>
      <div className="ui-note">
        {props.preset === "litellm"
          ? t("The address of your LiteLLM proxy and its key (a virtual key or the master key).")
          : t("Any server that speaks the OpenAI API: vLLM, Ollama, LM Studio, a corporate gateway.")}
      </div>
      <Field label={t("Name")}>
        <Input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="LiteLLM" />
      </Field>
      {!props.entry && (
        <Field label={t("Provider ID")} hint={t("Used in model names: {id}/model.", { id: providerID || "id" })}>
          <Input value={providerID} onChange={(event) => setID(event.currentTarget.value)} placeholder="litellm" />
        </Field>
      )}
      <Field label={t("Server address")}>
        <Input
          value={baseURL}
          onChange={(event) => setBaseURL(event.currentTarget.value)}
          placeholder="http://localhost:4000/v1"
        />
      </Field>
      <Field
        label={t("Key")}
        hint={
          props.entry?.hasKey
            ? t("A key is saved — leave empty to keep it.")
            : t("Leave empty if the server needs none.")
        }
      >
        <Input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} />
      </Field>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="ui-label">{t("Models")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || !baseURL.trim()}
            onClick={() => void discover()}
          >
            {t("Load from the server")}
          </Button>
        </div>
        {shown.length > 0 && (
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto" data-slot="own-provider-models">
            {shown.map((model) => {
              const item = models.find((m) => m.id === model)
              return (
                <div key={model} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Checkbox
                    label={model}
                    checked={chosen.has(model)}
                    onChange={(event) => toggle(model, event.currentTarget.checked)}
                  />
                  {item && (
                    <span className="flex items-center gap-3" data-slot="own-provider-model-modalities">
                      <Checkbox
                        label={t("Sees pictures")}
                        checked={item.images === true}
                        onChange={(event) => mark(model, "images", event.currentTarget.checked)}
                      />
                      <Checkbox
                        label={t("Draws")}
                        checked={item.draws === true}
                        onChange={(event) => mark(model, "draws", event.currentTarget.checked)}
                      />
                    </span>
                  )}
                  {item && (
                    <label className="flex basis-full items-center gap-2 pl-6" data-slot="own-provider-model-size">
                      <span className="ui-hint">{t("Context window")}</span>
                      <Input
                        className="w-24"
                        data-slot="own-provider-model-window"
                        value={windows[model] ?? ""}
                        placeholder="200k"
                        aria-label={t("Context window of {model}", { model })}
                        aria-invalid={unread(model) || undefined}
                        title={t("The model's context window in tokens: 128k, 1M. Empty — not set, 200k is assumed.")}
                        onChange={(event) => size(model, event.currentTarget.value)}
                      />
                      {!windows[model]?.trim() && <span className="ui-hint">{t("not set, 200k is assumed")}</span>}
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={typed}
            placeholder={t("Model ID, e.g. gpt-4o")}
            aria-label={t("Model ID, e.g. gpt-4o")}
            onChange={(event) => setTyped(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              add()
            }}
          />
          <Button type="button" size="sm" variant="ghost" leadingIcon={Plus} disabled={!typed.trim()} onClick={add}>
            {t("Add")}
          </Button>
        </div>
      </div>
      {problem && (
        <Callout tone="crit">
          <span data-slot="own-provider-problem">{problem}</span>
        </Callout>
      )}
      <div className="flex items-center justify-end gap-2">
        {invalid && <span className="ui-hint">{invalid}</span>}
        <Button type="submit" disabled={!!invalid || saving} data-action="own-provider-save">
          {t("Save")}
        </Button>
      </div>
    </form>
  )
}
