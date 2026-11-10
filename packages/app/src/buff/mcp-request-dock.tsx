import { createEffect, createMemo, createSignal, For, Match, Show, Switch as Branch } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import type { FormInfo, FormStringField } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Markdown } from "@opencode/session-ui/markdown"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useParams } from "@solidjs/router"
import { useBuffText } from "./i18n"
import {
  fieldView,
  formAnswer,
  hiddenField,
  formDefaults,
  formProblem,
  isSetupForm,
  mcpForm,
  setupForm,
  withOwn,
  type Own,
  type Values,
} from "./mcp-request"
import { Choice, Problem } from "./settings-kit"
import "./mcp-request-dock.css"

/**
 * Запрос MCP-сервера над полем ввода (#470): например, «Добавить эту запись в базу знаний?».
 * Сервер не знает сессии — форма общая для каталога, как и в консоли. Тем же доком показывается
 * форма режима «Настройка» (#765) — она принадлежит текущей сессии: секрет вводится с маской,
 * к вариантам можно дописать свои.
 */
export function BuffMcpFormDock() {
  const data = useData()
  const params = useParams<{ id?: string }>()
  const location = useWorkspaceLocation()
  const ref = () => ({ directory: location().directory })
  createEffect(() => void data.session.form.sync("global", ref()).catch(() => undefined))
  const form = createMemo(
    () =>
      (params.id ? setupForm(data.session.form.list(params.id)) : undefined) ??
      mcpForm(data.session.form.list("global", ref())),
  )
  return (
    <Show when={form()} keyed>
      {(request) => <McpForm request={request} location={ref()} />}
    </Show>
  )
}

function McpForm(props: { request: FormInfo; location: { directory: string } }) {
  const data = useData()
  const platform = usePlatform()
  const { t } = useBuffText()
  const [values, setValues] = createStore<Values>(formDefaults(props.request.fields))
  const [own, setOwn] = createStore<Own>({})
  const [draft, setDraft] = createStore<Record<string, string>>({})
  const [problem, setProblem] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const setup = () => isSetupForm(props.request)
  const metadata = () => (props.request.metadata ?? {}) as { server?: unknown; message?: unknown; note?: unknown }
  const server = () => (typeof metadata().server === "string" ? metadata().server : "MCP") as string
  const message = () => {
    const text = setup() ? metadata().note : metadata().message
    return (typeof text === "string" ? text : "") as string
  }
  const fields = () => props.request.fields
  const yesNo = () => fields().find((field) => fieldView(field, fields()) === "yes-no")
  const link = () => fields().some((field) => field.type === "external")
  const input = () => ({ sessionID: props.request.sessionID, formID: props.request.id })

  const settle = (work: Promise<unknown>) => {
    setBusy(true)
    setProblem(undefined)
    work.then(
      () => setBusy(false),
      (error: unknown) => {
        setBusy(false)
        setProblem(formatServerError(error, undefined, t("The answer was not sent.")))
      },
    )
  }
  const send = (override?: Values) => {
    const current = withOwn(fields(), { ...values, ...override }, own)
    const invalid = formProblem(fields(), current, t)
    if (invalid) return setProblem(invalid)
    settle(data.session.form.reply({ ...input(), answer: formAnswer(fields(), current) }, props.location))
  }
  const decline = () => settle(data.session.form.cancel(input(), props.location))
  const toggle = (key: string, option: string, on: boolean) => {
    const picked = (values[key] as string[] | undefined) ?? []
    setValues(key, on ? [...picked, option] : picked.filter((value) => value !== option))
  }
  // Свои варианты (#765): к нескольким — списком, по одному; к выбору одного — одно поле.
  const addOwn = (key: string) => {
    const text = (draft[key] ?? "").trim()
    if (!text) return
    setOwn(key, [...(own[key] ?? []).filter((item) => item !== text), text])
    setDraft(key, "")
  }
  const dropOwn = (key: string, text: string) =>
    setOwn(
      key,
      (own[key] ?? []).filter((item) => item !== text),
    )

  return (
    <DockPrompt
      kind="question"
      header={
        <span class="buff-mcp-form-title">{setup() ? props.request.title : BuffMcp.requestTitle(server(), t)}</span>
      }
      footer={
        <div class="buff-mcp-form-actions">
          <Button variant="ghost" size="large" disabled={busy()} onClick={decline} data-action="buff-mcp-form-decline">
            {t("Not now")}
          </Button>
          <Show
            when={yesNo()}
            fallback={
              <Button
                variant="submit"
                size="large"
                disabled={busy()}
                onClick={() => send()}
                data-action="buff-mcp-form-send"
              >
                {link() ? t("Done") : t("Send")}
              </Button>
            }
          >
            {(field) => (
              <Button
                variant="submit"
                size="large"
                disabled={busy()}
                onClick={() => send({ [field().key]: true })}
                data-action="buff-mcp-form-yes"
              >
                {field().title ?? t("Yes")}
              </Button>
            )}
          </Show>
        </div>
      }
    >
      <div
        class="buff-mcp-form"
        data-component="buff-mcp-form"
        data-server={server()}
        data-kind={setup() ? "setup" : "mcp"}
      >
        <Show when={message()}>
          <Markdown class="buff-mcp-form-message" text={BuffMcp.messageMarkdown(message())} />
        </Show>
        <For each={fields().filter((field) => !hiddenField(field))}>
          {(field) => (
            <Branch>
              <Match when={field.type === "boolean" && fieldView(field, fields()) === "switch"}>
                <Switch checked={values[field.key] === true} onChange={(on) => setValues(field.key, on)}>
                  {field.title ?? field.key}
                </Switch>
              </Match>
              <Match when={field.type === "string" && field.options?.length ? field : undefined}>
                {(choice) => (
                  <label class="buff-mcp-form-field">
                    <span>{choice().title ?? choice().key}</span>
                    <Choice
                      value={String(values[choice().key] ?? "")}
                      options={(choice() as FormStringField).options ?? []}
                      onPick={(value) => {
                        setValues(choice().key, value)
                        setOwn(choice().key, [])
                      }}
                    />
                    <Show when={(choice() as FormStringField).custom}>
                      <TextField
                        label={t("Own answer")}
                        hideLabel
                        placeholder={t("Own answer")}
                        value={own[choice().key]?.[0] ?? ""}
                        onChange={(value) => setOwn(choice().key, value.trim() ? [value] : [])}
                        data-slot="buff-mcp-form-own-one"
                      />
                    </Show>
                  </label>
                )}
              </Match>
              <Match when={field.type === "multiselect" ? field : undefined}>
                {(multi) => (
                  <fieldset class="buff-mcp-form-field">
                    <legend>{multi().title ?? multi().key}</legend>
                    <For each={multi().options}>
                      {(option) => (
                        <Switch
                          checked={((values[multi().key] as string[] | undefined) ?? []).includes(option.value)}
                          onChange={(on) => toggle(multi().key, option.value, on)}
                        >
                          {option.label}
                        </Switch>
                      )}
                    </For>
                    <Show when={multi().custom}>
                      <For each={own[multi().key] ?? []}>
                        {(text) => (
                          <div class="buff-mcp-form-own" data-slot="buff-mcp-form-own">
                            <span>{text}</span>
                            <Button variant="ghost" size="small" onClick={() => dropOwn(multi().key, text)}>
                              {t("Remove")}
                            </Button>
                          </div>
                        )}
                      </For>
                      <div class="buff-mcp-form-own-add">
                        <TextField
                          label={t("Own answer")}
                          hideLabel
                          placeholder={t("Own answer")}
                          value={draft[multi().key] ?? ""}
                          onChange={(value) => setDraft(multi().key, value)}
                          onKeyDown={(event: KeyboardEvent) => {
                            if (event.key !== "Enter") return
                            event.preventDefault()
                            addOwn(multi().key)
                          }}
                        />
                        <Button
                          variant="neutral"
                          onClick={() => addOwn(multi().key)}
                          data-action="buff-mcp-form-own-add"
                        >
                          {t("Add")}
                        </Button>
                      </div>
                    </Show>
                  </fieldset>
                )}
              </Match>
              <Match when={field.type === "external" ? field : undefined}>
                {(external) => (
                  <div class="buff-mcp-form-field">
                    <span>{external().title ?? t("The server asks you to open a page.")}</span>
                    <Button
                      variant="neutral"
                      onClick={() => {
                        platform.openExternal(external().url)
                        setValues(external().key, true)
                      }}
                      data-action="buff-mcp-form-open"
                    >
                      {values[external().key] === true ? t("Open the page again") : t("Open the page")}
                    </Button>
                  </div>
                )}
              </Match>
              <Match when={fieldView(field, fields()) === "secret"}>
                <TextField
                  type="password"
                  autocomplete="new-password"
                  label={field.title ?? field.key}
                  description={field.description}
                  placeholder={field.type === "secret" ? field.placeholder : undefined}
                  value={String(values[field.key] ?? "")}
                  onChange={(value) => setValues(field.key, value)}
                  data-slot="buff-mcp-form-secret"
                />
              </Match>
              <Match when={fieldView(field, fields()) === "text"}>
                <TextField
                  label={field.title ?? field.key}
                  description={field.description}
                  value={String(values[field.key] ?? "")}
                  onChange={(value) => setValues(field.key, value)}
                />
              </Match>
            </Branch>
          )}
        </For>
        <Problem text={problem()} />
      </div>
    </DockPrompt>
  )
}
