import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { useMcpToggle } from "@/providers/connect/mcp"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"
import { emptyForm, formFromConfig, formToServers, type McpForm } from "./mcp-form"
import { Choice, ConfirmDialog, FormBody, Hint, Problem } from "./settings-kit"
import "./mcp-settings.css"

/**
 * MCP-серверы в настройках (#444): добавить, поправить, удалить, включить и выключить — без
 * правки файла руками. Настройки сервера показывают серверы пользователя, настройки проекта —
 * ещё и серверы проекта. Статус и причина ошибки — теми же словами, что везде
 * (`BuffMcp.statusText`).
 */

const SCOPE_TITLE: Record<BuffMcp.Entry["scope"], string> = {
  project: "Project servers",
  user: "Your servers — in all projects",
  builtin: "Buff Code servers",
}
const SCOPE_EMPTY: Record<BuffMcp.Scope, string> = {
  project: "This project has no servers of its own.",
  user: "No servers of your own yet.",
}

type Controller = ReturnType<typeof createController>
/** Форма, пока её правят. */
type Draft = { -readonly [Key in keyof McpForm]: McpForm[Key] }

function createController(directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffMcp.Rpc)
  const at = () => {
    const value = directory()
    return value ? { location: { directory: value } } : undefined
  }
  const [entries, { refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? (directory() ?? "") : undefined),
    () => rpc.list(undefined, at()).catch(() => [] as BuffMcp.Entry[]),
    { initialValue: [] },
  )
  // Подключение занимает время: статус после правки дочитывается, пока сервер поднимается.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const settle = () => {
    void refetch()
    for (const delay of [1000, 3000, 8000]) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        void refetch()
      }, delay)
      timers.add(timer)
    }
  }
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => {
      stop.abort()
      timers.forEach(clearTimeout)
    })
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) settle()
    })().catch(() => undefined)
  })
  const failed = (error: unknown) =>
    showToast({ title: t("MCP server"), description: formatServerError(error, undefined, t("Could not save.")) })

  return {
    entries: () => entries.latest ?? [],
    refetch: settle,
    save: (
      servers: readonly { name: string; config: BuffMcp.Entry["config"] & {} }[],
      scope: BuffMcp.Scope,
      previous?: { scope: BuffMcp.Scope; name: string },
    ) =>
      Promise.all(
        servers.map((server, index) =>
          rpc.save(
            { scope, name: server.name, config: server.config, ...(index === 0 && previous ? { previous } : {}) },
            at(),
          ),
        ),
      ).then(settle),
    remove: (entry: BuffMcp.Entry) =>
      entry.scope === "builtin"
        ? Promise.resolve()
        : rpc.remove({ scope: entry.scope, name: entry.name }, at()).then(settle, failed),
    enable: (entry: BuffMcp.Entry, enabled: boolean) =>
      entry.scope === "builtin"
        ? Promise.resolve()
        : rpc.enable({ scope: entry.scope, name: entry.name, enabled }, at()).then(settle, failed),
  }
}

function ServerDialog(props: { controller: Controller; scopes: readonly BuffMcp.Scope[]; entry?: BuffMcp.Entry }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const stored = props.entry?.scope !== "builtin" ? props.entry : undefined
  const [form, setForm] = createStore<Draft>(
    stored?.config
      ? formFromConfig(stored.name, stored.scope as BuffMcp.Scope, stored.config)
      : { ...emptyForm(props.scopes[0]), name: stored?.name ?? "", mode: stored ? "json" : "fields" },
  )
  const [problem, setProblem] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    const read = formToServers(form, stored?.config, t)
    if ("problem" in read) return setProblem(read.problem)
    setSaving(true)
    const previous = stored ? { scope: stored.scope as BuffMcp.Scope, name: stored.name } : undefined
    await props.controller.save(read.servers, form.scope, previous).then(
      () => dialog.close(),
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))),
    )
    setSaving(false)
  }
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{stored ? t("Server «{name}»", { name: stored.name }) : t("New MCP server")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-mcp-form">
          <Choice
            value={form.mode}
            options={[
              { value: "fields", label: t("Fields") },
              { value: "json", label: "JSON" },
            ]}
            onPick={(value) => setForm("mode", value)}
          />
          <TextField
            label={t("Short name")}
            placeholder="github"
            value={form.name}
            onChange={(value) => setForm("name", value)}
          />
          <Hint>{t("Latin letters, digits, hyphen. The model sees the server under this name.")}</Hint>
          <Show when={props.scopes.length > 1}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-weak">{t("Where to keep")}</span>
              <Choice
                value={form.scope}
                options={[
                  { value: "project", label: t("In the project") },
                  { value: "user", label: t("On my machine — for all projects") },
                ]}
                onPick={(value) => setForm("scope", value)}
              />
              <span class="text-12-regular text-text-weak">
                {form.scope === "project"
                  ? t("The entry goes to the project's buffcode.json and to the repository — do not put keys in it.")
                  : t("The entry stays on this machine, in your configuration.")}
              </span>
            </div>
          </Show>
          <Show
            when={form.mode === "fields"}
            fallback={
              <>
                <TextField
                  multiline
                  label={t("Server description")}
                  class="buff-kit-area buff-kit-area--tall font-mono"
                  placeholder={
                    '{ "command": "npx", "args": ["-y", "@acme/server"], "env": { "TOKEN": "{env:TOKEN}" } }'
                  }
                  value={form.json}
                  onChange={(value) => setForm("json", value)}
                />
                <Hint>
                  {t(
                    "An entry from another agent's settings will do, and so will a whole mcpServers block — then every server in it is saved.",
                  )}
                </Hint>
              </>
            }
          >
            <Choice
              value={form.kind}
              options={[
                { value: "local", label: t("A command on this machine") },
                { value: "remote", label: t("A network address") },
              ]}
              onPick={(value) => setForm("kind", value)}
            />
            <Show
              when={form.kind === "local"}
              fallback={
                <>
                  <TextField
                    label={t("Address")}
                    placeholder="https://mcp.example.com/mcp"
                    value={form.url}
                    onChange={(value) => setForm("url", value)}
                  />
                  <TextField
                    multiline
                    label={t("Headers")}
                    class="buff-kit-area font-mono"
                    placeholder="Authorization=Bearer {env:TOKEN}"
                    value={form.headers}
                    onChange={(value) => setForm("headers", value)}
                  />
                  <Hint>{t("One header per line, as NAME=value. {env:NAME} inserts an environment variable.")}</Hint>
                </>
              }
            >
              <TextField
                label={t("Command")}
                placeholder="npx -y @acme/server"
                value={form.command}
                onChange={(value) => setForm("command", value)}
              />
              <Hint>{t("The program and its arguments, as in a terminal.")}</Hint>
              <TextField
                multiline
                label={t("Environment variables")}
                class="buff-kit-area font-mono"
                placeholder="TOKEN={env:TOKEN}"
                value={form.environment}
                onChange={(value) => setForm("environment", value)}
              />
              <Hint>{t("One variable per line, as NAME=value. {env:NAME} inserts an environment variable.")}</Hint>
            </Show>
          </Show>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-mcp-save" disabled={saving()} onClick={() => void save()}>
          {t(stored ? "Save" : "Add")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function summary(entry: BuffMcp.Entry): string | undefined {
  if (!entry.config) return undefined
  return entry.config.type === "local" ? BuffMcp.commandLine(entry.config.command) : entry.config.url
}

function ServerRow(props: {
  entry: BuffMcp.Entry
  controller: Controller
  scopes: readonly BuffMcp.Scope[]
  directory: Accessor<string | undefined>
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const status = () => BuffMcp.statusText(props.entry.status, t)
  const toggle = useMcpToggle(props.directory, props.controller.refetch)
  const own = () => props.entry.scope !== "builtin"
  const setEnabled = (enabled: boolean) => {
    // Свой сервер включается и выключается записью в файл — это переживает перезапуск; сервер
    // Buff Code и вход на сервер, который его просит, идут прежним путём.
    if (own() && props.entry.status.status !== "needs_auth") return void props.controller.enable(props.entry, enabled)
    toggle.mutate(props.entry.name)
  }
  return (
    <div class="settings-extension-row" data-component="buff-mcp-row" data-server={props.entry.name}>
      <div class="settings-extension-lead">
        <span class="buff-mcp-dot" data-tone={status().tone} />
        <div class="buff-kit-copy">
          <span class="settings-extension-name truncate">{props.entry.name}</span>
          <Show when={summary(props.entry)}>
            {(text) => <span class="buff-mcp-summary truncate font-mono">{text()}</span>}
          </Show>
          <Show when={BuffMcp.builtinHint(props.entry.name, t)}>
            {(hint) => <span class="buff-mcp-summary truncate">{hint()}</span>}
          </Show>
          <span class="buff-mcp-status" data-tone={status().tone} title={status().details}>
            {status().label}
            <Show when={status().reason}>{(reason) => <> — {reason()}</>}</Show>
          </span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={own()}>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-mcp-edit"
            onClick={() =>
              void dialog.show(() => (
                <ServerDialog controller={props.controller} scopes={props.scopes} entry={props.entry} />
              ))
            }
          >
            {t("Edit")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-mcp-remove"
            onClick={() =>
              void dialog.show(() => (
                <ConfirmDialog
                  title={t("Delete the server «{name}»?", { name: props.entry.name })}
                  text={t("The entry will be removed from {file}. The model will stop seeing this server's tools.", {
                    file: props.entry.file ?? "",
                  })}
                  confirm={t("Delete")}
                  onConfirm={() => void props.controller.remove(props.entry)}
                />
              ))
            }
          >
            {t("Delete")}
          </Button>
        </Show>
        <Switch checked={props.entry.status.status !== "disabled"} onChange={setEnabled} hideLabel>
          {props.entry.name}
        </Switch>
      </div>
    </div>
  )
}

/** `scopes` — области, в которые здесь можно добавлять; первая — та, что предлагается по умолчанию. */
export function BuffMcpSection(props: { directory: Accessor<string | undefined>; scopes: readonly BuffMcp.Scope[] }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const controller = createController(props.directory)
  const groups = createMemo(() =>
    ([...props.scopes, "builtin"] as BuffMcp.Entry["scope"][]).map((scope) => ({
      scope,
      entries: controller.entries().filter((entry) => entry.scope === scope),
    })),
  )
  const add = () => void dialog.show(() => <ServerDialog controller={controller} scopes={props.scopes} />)

  return (
    <div class="flex flex-col gap-6" data-component="buff-mcp-section">
      <For each={groups()}>
        {(group, index) => (
          <Show when={group.scope !== "builtin" || group.entries.length > 0}>
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">{t(SCOPE_TITLE[group.scope])}</span>
                <Show when={index() === 0}>
                  <Button size="small" variant="neutral" icon="plus" data-action="buff-mcp-add" onClick={add}>
                    {t("Add server")}
                  </Button>
                </Show>
              </div>
              <Show
                when={group.entries.length > 0}
                fallback={
                  <span class="text-13-regular text-v2-text-text-muted">
                    {group.scope === "builtin" ? "" : t(SCOPE_EMPTY[group.scope])}
                  </span>
                }
              >
                <SettingsList variant="catalog">
                  <For each={group.entries}>
                    {(entry) => (
                      <ServerRow
                        entry={entry}
                        controller={controller}
                        scopes={props.scopes}
                        directory={props.directory}
                      />
                    )}
                  </For>
                </SettingsList>
              </Show>
            </div>
          </Show>
        )}
      </For>
    </div>
  )
}
