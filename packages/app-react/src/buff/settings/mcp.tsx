// MCP servers in settings (#444), ported from the Solid window's buff/mcp-settings.tsx: add, edit,
// delete, switch on and off — without editing the file by hand. Server settings show the person's
// servers, project settings the project's too. Status and failure in the same words everywhere
// (BuffMcp.statusText).

import "./settings.css"
import { Button, Field, Input, Panel, Switch, Textarea } from "@buff/ui/react"
import { emptyForm, formFromConfig, formToServers, type McpForm } from "@opencode/app/react-reuse/mcp-form"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { Plus } from "lucide-react"
import { useState } from "react"
import type { Server } from "../../core/servers"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { showToast } from "../../shell/notifications/toast"
import { Choice, FormDialog, Hint, Problem } from "./kit"
import { at, useBuffList } from "./rpc"

const SCOPE_TITLE: Record<BuffMcp.Entry["scope"], string> = {
  project: "Project servers",
  user: "Your servers — in all projects",
  builtin: "Buff Code servers",
}
const SCOPE_EMPTY: Record<BuffMcp.Scope, string> = {
  project: "This project has no servers of its own.",
  user: "No servers of your own yet.",
}

type Draft = { -readonly [Key in keyof McpForm]: McpForm[Key] }
type Controller = ReturnType<typeof useMcpController>

function useMcpController(server: Server, directory: string | undefined) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const rpc = server.api().rpc(BuffMcp.Rpc)
  // Connecting takes a while: the status is read again while the server comes up.
  const list = useBuffList<readonly BuffMcp.Entry[]>({
    server,
    name: "mcp",
    directory,
    empty: [],
    load: () => rpc.list(undefined, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
    delays: [1000, 3000, 8000],
  })
  const settle = list.settle
  const failed = (error: unknown) =>
    showToast({ title: t("MCP server"), description: formatServerError(error, undefined, t("Could not save.")) })

  return {
    server,
    directory,
    entries: list.value,
    settle,
    save: (
      servers: readonly { name: string; config: NonNullable<BuffMcp.Entry["config"]> }[],
      scope: BuffMcp.Scope,
      previous?: { scope: BuffMcp.Scope; name: string },
    ) =>
      Promise.all(
        servers.map((item, index) =>
          rpc.save(
            { scope, name: item.name, config: item.config, ...(index === 0 && previous ? { previous } : {}) },
            at(directory),
          ),
        ),
      ).then(settle),
    remove: (entry: BuffMcp.Entry) =>
      entry.scope === "builtin"
        ? Promise.resolve()
        : rpc.remove({ scope: entry.scope, name: entry.name }, at(directory)).then(settle, failed),
    enable: (entry: BuffMcp.Entry, enabled: boolean) =>
      entry.scope === "builtin"
        ? Promise.resolve()
        : rpc.enable({ scope: entry.scope, name: entry.name, enabled }, at(directory)).then(settle, failed),
  }
}

/**
 * Switch a server through the connection itself (Buff Code's servers, and a server that asks to
 * sign in: its sign-in page opens), as the Solid window's useMcpToggle does.
 */
async function toggleConnection(
  server: Server,
  directory: string | undefined,
  name: string,
  openExternal: (url: string) => void,
  interactiveForm: string,
) {
  const location = directory ? { directory } : server.data.location.default()
  const current = (await server.api().mcp.list({ location })).data.find((item) => item.name === name)
  if (!current || current.status.status === "pending") return
  const enabled = current.status.status !== "connected"
  if (!enabled) await server.api().mcp.disconnect({ server: name, location })
  if (enabled && current.status.status !== "needs_auth") await server.api().mcp.connect({ server: name, location })
  server.data.location.mcpServer.invalidate(location)
  await server.data.location.mcpServer.sync(location)
  const after = server.data.location.mcpServer.list(location)?.find((item) => item.name === name)
  if (enabled && after?.status.status === "needs_auth" && after.integrationID) {
    const integration = await server.api().integration.get({ integrationID: after.integrationID, location })
    const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)
    if (!method || method.type !== "oauth") throw new Error(interactiveForm)
    const attempt = await server
      .api()
      .integration.oauth.connect({ integrationID: after.integrationID, methodID: method.id, location })
    openExternal(attempt.data.url)
  }
  if (after?.status.status === "failed") throw new Error(`${name}: ${after.status.error}`)
}

function ServerDialog(props: {
  controller: Controller
  scopes: readonly BuffMcp.Scope[]
  entry?: BuffMcp.Entry
  onClose: () => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const stored = props.entry?.scope !== "builtin" ? props.entry : undefined
  const [form, setForm] = useState<Draft>(() => {
    const scope = stored?.scope === "project" || stored?.scope === "user" ? stored.scope : undefined
    if (stored?.config && scope) return formFromConfig(stored.name, scope, stored.config)
    return { ...emptyForm(props.scopes[0] ?? "user"), name: stored?.name ?? "", mode: stored ? "json" : "fields" }
  })
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const edit =
    <Key extends keyof Draft>(key: Key) =>
    (value: Draft[Key]) =>
      setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    const read = formToServers(form, stored?.config, t)
    if ("problem" in read) return setProblem(read.problem)
    setSaving(true)
    const previous =
      stored && (stored.scope === "project" || stored.scope === "user")
        ? { scope: stored.scope, name: stored.name }
        : undefined
    await props.controller
      .save(read.servers, form.scope, previous)
      .then(props.onClose, (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))))
    setSaving(false)
  }

  return (
    <FormDialog
      title={stored ? t("Server «{name}»", { name: stored.name }) : t("New MCP server")}
      name="buff-mcp-form"
      action={t(stored ? "Save" : "Add")}
      actionTarget="buff-mcp-save"
      busy={saving}
      onClose={props.onClose}
      onSubmit={() => void save()}
    >
      <Choice
        value={form.mode}
        options={[
          { value: "fields", label: t("Fields") },
          { value: "json", label: "JSON" },
        ]}
        onPick={edit("mode")}
      />
      <Field
        label={t("Short name")}
        hint={t("Latin letters, digits, hyphen. The model sees the server under this name.")}
      >
        <Input value={form.name} placeholder="github" onChange={(event) => edit("name")(event.currentTarget.value)} />
      </Field>
      {props.scopes.length > 1 && (
        <Field
          group
          label={t("Where to keep")}
          hint={
            form.scope === "project"
              ? t("The entry goes to the project's buffcode.json and to the repository — do not put keys in it.")
              : t("The entry stays on this machine, in your configuration.")
          }
        >
          <Choice
            value={form.scope}
            options={[
              { value: "project", label: t("In the project") },
              { value: "user", label: t("On my machine — for all projects") },
            ]}
            onPick={edit("scope")}
          />
        </Field>
      )}
      {form.mode === "json" && (
        <>
          <Field label={t("Server description")}>
            <Textarea
              rows={9}
              className="font-mono"
              value={form.json}
              placeholder='{ "command": "npx", "args": ["-y", "@acme/server"], "env": { "TOKEN": "{env:TOKEN}" } }'
              onChange={(event) => edit("json")(event.currentTarget.value)}
            />
          </Field>
          <Hint>
            {t(
              "An entry from another agent's settings will do, and so will a whole mcpServers block — then every server in it is saved.",
            )}
          </Hint>
        </>
      )}
      {form.mode === "fields" && (
        <>
          <Choice
            value={form.kind}
            options={[
              { value: "local", label: t("A command on this machine") },
              { value: "remote", label: t("A network address") },
            ]}
            onPick={edit("kind")}
          />
          {form.kind === "local" && (
            <>
              <Field label={t("Command")} hint={t("The program and its arguments, as in a terminal.")}>
                <Input
                  value={form.command}
                  placeholder="npx -y @acme/server"
                  onChange={(event) => edit("command")(event.currentTarget.value)}
                />
              </Field>
              <Field
                label={t("Environment variables")}
                hint={t("One variable per line, as NAME=value. {env:NAME} inserts an environment variable.")}
              >
                <Textarea
                  rows={3}
                  className="font-mono"
                  value={form.environment}
                  placeholder="TOKEN={env:TOKEN}"
                  onChange={(event) => edit("environment")(event.currentTarget.value)}
                />
              </Field>
            </>
          )}
          {form.kind === "remote" && (
            <>
              <Field label={t("Address")}>
                <Input
                  value={form.url}
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(event) => edit("url")(event.currentTarget.value)}
                />
              </Field>
              <Field
                label={t("Headers")}
                hint={t("One header per line, as NAME=value. {env:NAME} inserts an environment variable.")}
              >
                <Textarea
                  rows={3}
                  className="font-mono"
                  value={form.headers}
                  placeholder="Authorization=Bearer {env:TOKEN}"
                  onChange={(event) => edit("headers")(event.currentTarget.value)}
                />
              </Field>
            </>
          )}
        </>
      )}
      <Problem text={problem} />
    </FormDialog>
  )
}

function summary(entry: BuffMcp.Entry) {
  if (!entry.config) return undefined
  return entry.config.type === "local" ? BuffMcp.commandLine(entry.config.command) : entry.config.url
}

function ServerRow(props: { entry: BuffMcp.Entry; controller: Controller; scopes: readonly BuffMcp.Scope[] }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const platform = usePlatform()
  const status = BuffMcp.statusText(props.entry.status, t)
  const own = props.entry.scope !== "builtin"
  const hint = BuffMcp.builtinHint(props.entry.name, t)
  const line = summary(props.entry)
  const setEnabled = (enabled: boolean) => {
    // An own server switches by writing to its file — that survives a restart; Buff Code's servers
    // and signing in to a server that asks for it go through the connection.
    if (own && props.entry.status.status !== "needs_auth") return void props.controller.enable(props.entry, enabled)
    void toggleConnection(
      props.controller.server,
      props.controller.directory,
      props.entry.name,
      platform.openExternal,
      i18n.t("mcp.auth.interactiveForm", { name: props.entry.name }),
    )
      .then(props.controller.settle)
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
  }
  const remove = () =>
    void confirm(dialog, {
      title: t("Delete the server «{name}»?", { name: props.entry.name }),
      text: t("The entry will be removed from {file}. The model will stop seeing this server's tools.", {
        file: props.entry.file ?? "",
      }),
      action: t("Delete"),
      cancel: t("Cancel"),
      danger: true,
    }).then((yes) => {
      if (yes) void props.controller.remove(props.entry)
    })

  return (
    <div className="buff-settings-row" data-component="buff-mcp-row" data-server={props.entry.name}>
      <div className="buff-settings-lead">
        <span className="buff-mcp-dot" data-tone={status.tone} />
        <div className="buff-settings-copy">
          <span className="buff-settings-name truncate">{props.entry.name}</span>
          {line && <span className="buff-settings-note truncate font-mono">{line}</span>}
          {hint && <span className="buff-settings-note truncate">{hint}</span>}
          <span className="buff-mcp-status" data-tone={status.tone} title={status.details}>
            {status.label}
            {status.reason && <> — {status.reason}</>}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {own && (
          <>
            <Button
              variant="ghost"
              size="sm"
              data-action="buff-mcp-edit"
              onClick={() =>
                dialog.show((close) => (
                  <ServerDialog
                    controller={props.controller}
                    scopes={props.scopes}
                    entry={props.entry}
                    onClose={close}
                  />
                ))
              }
            >
              {t("Edit")}
            </Button>
            <Button variant="ghost" size="sm" data-action="buff-mcp-remove" onClick={remove}>
              {t("Delete")}
            </Button>
          </>
        )}
        <Switch
          aria-label={props.entry.name}
          checked={props.entry.status.status !== "disabled"}
          onCheckedChange={setEnabled}
        />
      </div>
    </div>
  )
}

/** `scopes` — where servers can be added here; the first is the one offered by default. */
export function BuffMcpSection(props: { server: Server; directory?: string; scopes: readonly BuffMcp.Scope[] }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const controller = useMcpController(props.server, props.directory)
  const scopes: BuffMcp.Entry["scope"][] = [...props.scopes, "builtin"]
  const add = () =>
    dialog.show((close) => <ServerDialog controller={controller} scopes={props.scopes} onClose={close} />)

  return (
    <div className="flex flex-col gap-6" data-component="buff-mcp-section">
      {scopes.map((scope, index) => {
        const entries = controller.entries.filter((entry) => entry.scope === scope)
        if (scope === "builtin" && entries.length === 0) return null
        return (
          <div key={scope} className="settings-section">
            <div className="flex items-center justify-between gap-2">
              <span className="settings-section-title">{t(SCOPE_TITLE[scope])}</span>
              {index === 0 && (
                <Button size="sm" leadingIcon={Plus} data-action="buff-mcp-add" onClick={add}>
                  {t("Add server")}
                </Button>
              )}
            </div>
            {entries.length === 0 && scope !== "builtin" && <span className="ui-note">{t(SCOPE_EMPTY[scope])}</span>}
            {entries.length > 0 && (
              <Panel data-component="settings-list" data-variant="catalog">
                {entries.map((entry) => (
                  <ServerRow
                    key={`${entry.scope}:${entry.name}`}
                    entry={entry}
                    controller={controller}
                    scopes={props.scopes}
                  />
                ))}
              </Panel>
            )}
          </div>
        )
      })}
    </div>
  )
}
