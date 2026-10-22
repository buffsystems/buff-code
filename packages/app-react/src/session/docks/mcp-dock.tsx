// A request from an MCP server above the composer (#584), ported from Buff's MCP request dock
// (#470): "Add this entry to the knowledge base?" and other elicitations. The server knows no
// session, so the form belongs to the directory.

import { Button, Callout, Field, Input, SelectMenu, Switch } from "@buff/ui/react"
import { fieldView, formAnswer, formDefaults, formProblem, hiddenField, mcpForm, type Values } from "@opencode/app/react-reuse/mcp-request"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import type { FormInfo } from "@opencode/client/promise"
import { useEffect, useMemo, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { useCore, useServerData } from "../../react/core"
import { useSession } from "../context"
import { DockPrompt } from "./dock"

export function McpDock() {
  const { server, sessionID } = useSession()
  const directory = useServerData(server, (state) => state.session.info[sessionID]?.location.directory)
  const ref = useMemo(() => (directory === undefined ? undefined : { directory }), [directory])
  useEffect(() => {
    if (ref) void server.data.session.form.sync("global", ref).catch(() => undefined)
  }, [server, ref])
  const forms = useServerData(server, (state) => state.session.form.global)
  const form = ref ? mcpForm(forms?.filter((item) => item.location?.directory === ref.directory)) : undefined
  if (!form || !ref) return null
  return <McpForm key={form.id} request={form} location={ref} />
}

function McpForm(props: { request: FormInfo; location: { directory: string } }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const core = useCore()
  const { server } = useSession()
  const fields = props.request.fields
  const [values, setValues] = useState<Values>(() => formDefaults(fields))
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const metadata = (props.request.metadata ?? {}) as { server?: unknown; message?: unknown }
  const name = typeof metadata.server === "string" ? metadata.server : "MCP"
  const message = typeof metadata.message === "string" ? metadata.message : ""
  const yesNo = fields.find((field) => fieldView(field, fields) === "yes-no")
  const link = fields.some((field) => field.type === "external")
  const target = { sessionID: props.request.sessionID, formID: props.request.id }
  const set = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }))

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
    const current = { ...values, ...override }
    const invalid = formProblem(fields, current, t)
    if (invalid) return setProblem(invalid)
    settle(server.data.session.form.reply({ ...target, answer: formAnswer(fields, current) }, props.location))
  }

  return (
    <DockPrompt
      kind="question"
      header={<span className="dock-prompt__title">{BuffMcp.requestTitle(name, t)}</span>}
      footer={
        <div className="dock-prompt__actions ms-auto">
          <Button variant="ghost" disabled={busy} onClick={() => settle(server.data.session.form.cancel(target, props.location))} data-action="buff-mcp-form-decline">
            {t("Not now")}
          </Button>
          {yesNo ? (
            <Button variant="primary" disabled={busy} onClick={() => send({ [yesNo.key]: true })} data-action="buff-mcp-form-yes">
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
      <div className="mcp-form" data-component="buff-mcp-form" data-server={name}>
        {message && <div className="ui-prose mcp-form__message">{BuffMcp.messageMarkdown(message)}</div>}
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
                <Field key={field.key} label={label}>
                  <SelectMenu
                    aria-label={label}
                    options={field.options}
                    value={String(values[field.key] ?? "")}
                    onValueChange={(value) => set(field.key, value)}
                  />
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
                            set(field.key, on ? [...picked, option.value] : picked.filter((value) => value !== option.value))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
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
                      core.platform.openExternal(field.url)
                      set(field.key, true)
                    }}
                  >
                    {values[field.key] === true ? t("Open the page again") : t("Open the page")}
                  </Button>
                </div>
              )
            if (view !== "text") return null
            return (
              <Field key={field.key} label={label} hint={field.description}>
                <Input value={String(values[field.key] ?? "")} onChange={(event) => set(field.key, event.currentTarget.value)} />
              </Field>
            )
          })}
        {problem && <Callout tone="crit">{problem}</Callout>}
      </div>
    </DockPrompt>
  )
}
