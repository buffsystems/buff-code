// A request from an MCP server above the composer (#584), ported from Buff's MCP request dock
// (#470): "Add this entry to the knowledge base?" and other elicitations. The server knows no
// session, so the form belongs to the directory. The same dock shows Setup mode's form (#775/#860):
// it belongs to the current session, its secret is typed masked and never shown back, and a choice
// may take the person's own answers.

import { Button, Callout, Field, Input, SelectMenu, Switch } from "@buff/ui/react"
import {
  fieldView,
  formAnswer,
  formDefaults,
  formProblem,
  hiddenField,
  isSetupForm,
  mcpForm,
  setupForm,
  withOwn,
  type Own,
  type Values,
} from "@opencode/app/react-reuse/mcp-request"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import type { FormInfo } from "@opencode/client/promise"
import { useEffect, useMemo, useState } from "react"
import type { FormWithLocation } from "../../core/data/state"
import { useI18n } from "../../i18n/provider"
import { useCore, useServerData } from "../../react/core"
import { useSession } from "../context"
import { Markdown } from "../timeline/markdown/markdown"
import { DockPrompt } from "./dock"

/** The form the dock shows: the session's setup form first, else the directory's MCP request. */
export function dockForm(
  session: readonly FormInfo[] | undefined,
  global: readonly FormWithLocation[] | undefined,
  directory: string,
): FormInfo | undefined {
  return setupForm(session) ?? mcpForm(global?.filter((item) => item.location?.directory === directory))
}

export function McpDock() {
  const core = useCore()
  const { server, sessionID } = useSession()
  const directory = useServerData(server, (state) => state.session.info[sessionID]?.location.directory)
  const ref = useMemo(() => (directory === undefined ? undefined : { directory }), [directory])
  useEffect(() => {
    if (ref) void server.data.session.form.sync("global", ref).catch(() => undefined)
  }, [server, ref])
  const forms = useServerData(server, (state) => state.session.form[sessionID])
  const global = useServerData(server, (state) => state.session.form.global)
  const form = ref ? dockForm(forms, global, ref.directory) : undefined
  if (!form || !ref) return null
  return <McpForm key={form.id} request={form} location={ref} onOpenPage={(url) => core.platform.openExternal(url)} />
}

/** What the server says, as markdown (the knowledge entry's body is markdown): bold, lists, headings. */
export function McpMessage(props: { message: string }) {
  return <Markdown text={BuffMcp.messageMarkdown(props.message)} className="mcp-form__message" />
}

export function McpForm(props: {
  request: FormInfo
  location: { directory: string }
  onOpenPage: (url: string) => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const { server } = useSession()
  const fields = props.request.fields
  const [values, setValues] = useState<Values>(() => formDefaults(fields))
  const [own, setOwn] = useState<Own>({})
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const setup = isSetupForm(props.request)
  const metadata = (props.request.metadata ?? {}) as { server?: unknown; message?: unknown; note?: unknown }
  const name = typeof metadata.server === "string" ? metadata.server : "MCP"
  const text = setup ? metadata.note : metadata.message
  const message = typeof text === "string" ? text : ""
  const yesNo = fields.find((field) => fieldView(field, fields) === "yes-no")
  const link = fields.some((field) => field.type === "external")
  const target = { sessionID: props.request.sessionID, formID: props.request.id }
  const set = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }))
  const setOwnOf = (key: string, list: readonly string[]) => setOwn((current) => ({ ...current, [key]: list }))

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
    const current = withOwn(fields, { ...values, ...override }, own)
    const invalid = formProblem(fields, current, t)
    if (invalid) return setProblem(invalid)
    settle(server.data.session.form.reply({ ...target, answer: formAnswer(fields, current) }, props.location))
  }

  return (
    <DockPrompt
      kind="question"
      header={<span className="dock-prompt__title">{setup ? props.request.title : BuffMcp.requestTitle(name, t)}</span>}
      footer={
        <div className="dock-prompt__actions ms-auto">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => settle(server.data.session.form.cancel(target, props.location))}
            data-action="buff-mcp-form-decline"
          >
            {t("Not now")}
          </Button>
          {yesNo ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => send({ [yesNo.key]: true })}
              data-action="buff-mcp-form-yes"
            >
              {yesNo.title ?? t("Yes")}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => send()} data-action="buff-mcp-form-send">
              {link ? t("Done") : t("Send")}
            </Button>
          )}
        </div>
      }
    >
      <div className="mcp-form" data-component="buff-mcp-form" data-server={name} data-kind={setup ? "setup" : "mcp"}>
        {message && <McpMessage message={message} />}
        {fields
          .filter((field) => !hiddenField(field))
          .map((field) => {
            const view = fieldView(field, fields)
            const label = field.title ?? field.key
            if (field.type === "boolean" && view === "switch")
              return (
                <label key={field.key} className="mcp-form__switch">
                  <Switch checked={values[field.key] === true} onCheckedChange={(on) => set(field.key, on)} />
                  <span>{label}</span>
                </label>
              )
            if (field.type === "string" && field.options?.length)
              return (
                <Field key={field.key} label={label} group={field.custom === true}>
                  <SelectMenu
                    aria-label={label}
                    options={field.options}
                    value={String(values[field.key] ?? "")}
                    onValueChange={(value) => {
                      set(field.key, value)
                      setOwnOf(field.key, [])
                    }}
                  />
                  {field.custom && (
                    <Input
                      aria-label={t("Own answer")}
                      placeholder={t("Own answer")}
                      value={own[field.key]?.[0] ?? ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setOwnOf(field.key, value.trim() ? [value] : [])
                      }}
                      data-slot="buff-mcp-form-own-one"
                    />
                  )}
                </Field>
              )
            if (field.type === "multiselect")
              return (
                <fieldset key={field.key} className="mcp-form__group">
                  <legend>{label}</legend>
                  {field.options.map((option) => {
                    const picked = (values[field.key] as string[] | undefined) ?? []
                    return (
                      <label key={option.value} className="mcp-form__switch">
                        <Switch
                          checked={picked.includes(option.value)}
                          onCheckedChange={(on) =>
                            set(
                              field.key,
                              on ? [...picked, option.value] : picked.filter((value) => value !== option.value),
                            )
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
                  {field.custom && (
                    <OwnAnswers list={own[field.key] ?? []} onChange={(list) => setOwnOf(field.key, list)} />
                  )}
                </fieldset>
              )
            if (field.type === "external")
              return (
                <div key={field.key} className="mcp-form__group">
                  <span>{field.title ?? t("The server asks you to open a page.")}</span>
                  <Button
                    variant="outline"
                    data-action="buff-mcp-form-open"
                    onClick={() => {
                      props.onOpenPage(field.url)
                      set(field.key, true)
                    }}
                  >
                    {values[field.key] === true ? t("Open the page again") : t("Open the page")}
                  </Button>
                </div>
              )
            if (field.type === "secret")
              return (
                <Field key={field.key} label={label} hint={field.description}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder={field.placeholder}
                    value={String(values[field.key] ?? "")}
                    onChange={(event) => set(field.key, event.currentTarget.value)}
                    data-slot="buff-mcp-form-secret"
                  />
                </Field>
              )
            if (view !== "text") return null
            return (
              <Field key={field.key} label={label} hint={field.description}>
                <Input
                  value={String(values[field.key] ?? "")}
                  onChange={(event) => set(field.key, event.currentTarget.value)}
                />
              </Field>
            )
          })}
        {problem && <Callout tone="crit">{problem}</Callout>}
      </div>
    </DockPrompt>
  )
}

/** Own entries to a field of several options (#775): added one by one, removed one by one. */
function OwnAnswers(props: { list: readonly string[]; onChange: (list: readonly string[]) => void }) {
  const t = useI18n().buff.t
  const [draft, setDraft] = useState("")
  const add = () => {
    const text = draft.trim()
    if (!text) return
    props.onChange([...props.list.filter((item) => item !== text), text])
    setDraft("")
  }
  return (
    <>
      {props.list.map((text) => (
        <div
          key={text}
          data-slot="buff-mcp-form-own"
          className="flex items-center justify-between gap-2 border-s-2 border-border ps-2"
        >
          <span>{text}</span>
          <Button variant="ghost" size="sm" onClick={() => props.onChange(props.list.filter((item) => item !== text))}>
            {t("Remove")}
          </Button>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <Input
          className="flex-1"
          aria-label={t("Own answer")}
          placeholder={t("Own answer")}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            add()
          }}
          data-slot="buff-mcp-form-own-draft"
        />
        <Button variant="outline" onClick={add} data-action="buff-mcp-form-own-add">
          {t("Add")}
        </Button>
      </div>
    </>
  )
}
