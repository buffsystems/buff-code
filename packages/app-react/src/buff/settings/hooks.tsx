// Hooks in settings (#446), ported from the Solid window's buff/hook-settings.tsx: a shell command
// on an agent event — create, edit, delete, switch on and off. A project's hook does not run until
// it was checked and trusted here. Server settings show the person's hooks, project settings the
// project's too.

import "./settings.css"
import { Button, Field, Input, Panel, Switch, Textarea } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffHook } from "@opencode/schema/buff-hook"
import { Plus } from "lucide-react"
import { useState } from "react"
import type { Server } from "../../core/servers"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { SettingsList } from "../../settings/kit"
import { Choice, FormDialog, Hint, Problem, ReviewDialog } from "./kit"
import { at, useBuffList } from "./rpc"
import { BuffTrustPolicyRow } from "./trust-policy"

const SCOPE_OPTIONS = [
  { value: "project", label: "In the project" },
  { value: "user", label: "On my machine — for all projects" },
] as const
const SCOPE_NOTE: Record<BuffHook.Scope, string> = {
  project:
    "The hook goes to the project's .buffcode/hooks.json and to the repository. For everyone who opens the project, it works only after they confirm it.",
  user: "The hook stays on this machine, in your configuration.",
}
const GROUP_TITLE: Record<BuffHook.Scope, string> = {
  project: "Project hooks",
  user: "Your hooks — in all projects",
}
const GROUP_EMPTY: Record<BuffHook.Scope, string> = {
  project: "There are no hooks in this project.",
  user: "No hooks of your own yet.",
}

type Draft = { id: string; event: BuffHook.Event; tool: string; command: string; scope: BuffHook.Scope }
type Controller = ReturnType<typeof useHookController>

function useHookController(server: Server, directory: string | undefined) {
  const t = useI18n().buff.t
  const rpc = server.api().rpc(BuffHook.Rpc)
  const list = useBuffList<readonly BuffHook.Entry[]>({
    server,
    name: "hooks",
    directory,
    empty: [],
    load: () => rpc.list(undefined, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
    failure: t("Could not get the list."),
  })
  const failed = (error: unknown) =>
    showToast({ title: t("Hooks"), description: formatServerError(error, undefined, t("Could not save.")) })
  const target = (entry: BuffHook.Entry) => ({ scope: entry.scope, id: entry.id })
  return {
    problem: list.problem,
    entries: list.value,
    failed,
    save: (draft: Draft, previous?: { scope: BuffHook.Scope; id: string }) =>
      rpc.save({ ...draft, ...(previous ? { previous } : {}) }, at(directory)).then(list.settle),
    remove: (entry: BuffHook.Entry) => rpc.remove(target(entry), at(directory)).then(list.settle, failed),
    enable: (entry: BuffHook.Entry, enabled: boolean) =>
      rpc.enable({ ...target(entry), enabled }, at(directory)).then(list.settle, failed),
    review: (entry: BuffHook.Entry) => rpc.review({ id: entry.id }, at(directory)),
    /** Confirm what was reviewed; a string says why it did not work. */
    trust: (entry: BuffHook.Entry, token: string) =>
      rpc.trust({ id: entry.id, token }, at(directory)).then(
        () => {
          list.settle()
          return undefined
        },
        (error: unknown) => formatServerError(error, undefined, t("Could not confirm.")),
      ),
    distrust: (entry: BuffHook.Entry) => rpc.trust({ id: entry.id }, at(directory)).then(list.settle, failed),
  }
}

function HookDialog(props: {
  controller: Controller
  scopes: readonly BuffHook.Scope[]
  entry?: BuffHook.Entry
  onClose: () => void
}) {
  const t = useI18n().buff.t
  const stored = props.entry
  const [form, setForm] = useState<Draft>({
    id: stored?.id ?? "",
    event: stored?.event ?? "tool.after",
    tool: stored?.tool ?? "",
    command: stored?.command ?? "",
    scope: stored?.scope ?? props.scopes[0] ?? "user",
  })
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const event = BuffHook.EVENTS.find((item) => item.value === form.event)
  const edit = (patch: Partial<Draft>) => {
    setForm((current) => ({ ...current, ...patch }))
    setProblem(undefined)
  }
  const save = async () => {
    const draft: Draft = { ...form, id: form.id.trim(), tool: event?.tool ? form.tool : "" }
    const invalid = BuffHook.problem(draft, t)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    await props.controller
      .save(draft, stored ? { scope: stored.scope, id: stored.id } : undefined)
      .then(props.onClose, (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))))
    setSaving(false)
  }
  return (
    <FormDialog
      title={stored ? t("Hook «{id}»", { id: stored.id }) : t("New hook")}
      name="buff-hook-form"
      action={t(stored ? "Save" : "Create")}
      actionTarget="buff-hook-save"
      busy={saving}
      onClose={props.onClose}
      onSubmit={() => void save()}
    >
      <Field label={t("Short name")} hint={t("Lowercase Latin letters, digits and hyphen.")}>
        <Input value={form.id} placeholder="format" onChange={(event) => edit({ id: event.currentTarget.value })} />
      </Field>
      <Field group label={t("When to run")} hint={event ? t(event.hint) : undefined}>
        <Choice
          value={form.event}
          options={BuffHook.EVENTS.map((item) => ({ value: item.value, label: t(item.label) }))}
          onPick={(value) => edit({ event: value })}
        />
      </Field>
      {event?.tool && (
        <Field
          label={t("Tools")}
          hint={t("Names separated by commas; an asterisk matches any ending (github_*). Empty — any tool.")}
        >
          <Input
            value={form.tool}
            placeholder="edit, write"
            onChange={(item) => edit({ tool: item.currentTarget.value })}
          />
        </Field>
      )}
      <Field label={t("Command")}>
        <Textarea
          rows={3}
          className="font-mono"
          value={form.command}
          placeholder="bun run format"
          onChange={(item) => edit({ command: item.currentTarget.value })}
        />
      </Field>
      <Hint>
        {t(
          "Runs in the shell in the project directory, on your machine. The command gets the event as JSON: on standard input and in the BUFF_HOOK_EVENT variable.",
        )}
      </Hint>
      {props.scopes.length > 1 && (
        <Field group label={t("Where to keep")} hint={t(SCOPE_NOTE[form.scope])}>
          <Choice
            value={form.scope}
            options={SCOPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
            onPick={(scope) => edit({ scope })}
          />
        </Field>
      )}
      <Problem text={problem} />
    </FormDialog>
  )
}

function HookRow(props: { entry: BuffHook.Entry; controller: Controller; scopes: readonly BuffHook.Scope[] }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const entry = props.entry
  const active = entry.enabled && entry.trusted !== false
  const review = async () => {
    const reviewed = await props.controller.review(entry).catch((error: unknown) => {
      props.controller.failed(error)
      return undefined
    })
    if (!reviewed) return
    dialog.show((close) => (
      <ReviewDialog
        title={t("Trust the hook «{id}»?", { id: entry.id })}
        intro={t(
          "This hook came from the project. Its command will run by itself on your machine, outside the sandbox. If the hook changes, you will be asked to confirm again.",
        )}
        text={reviewed.text}
        onClose={close}
        onConfirm={() => props.controller.trust(entry, reviewed.token)}
      />
    ))
  }
  const remove = () =>
    void confirm(dialog, {
      title: t("Delete the hook «{id}»?", { id: entry.id }),
      text: t("The entry will be removed from {file}.", { file: entry.path }),
      action: t("Delete"),
      cancel: t("Cancel"),
      danger: true,
    }).then((yes) => {
      if (yes) void props.controller.remove(entry)
    })
  return (
    <div className="buff-settings-row" data-component="buff-hook-row" data-hook={entry.id} data-trusted={entry.trusted}>
      <div className="buff-settings-lead">
        <div className={active ? "buff-settings-copy" : "buff-settings-copy opacity-60"}>
          <span className="buff-settings-name truncate">{entry.id}</span>
          <span className="buff-settings-note">{BuffHook.summary(entry, t)}</span>
          <span className="buff-settings-note line-clamp-2 font-mono" title={entry.command}>
            {entry.command}
          </span>
          {entry.trusted === false && (
            <span className="buff-settings-note text-warning">{t(BuffHook.UNTRUSTED_NOTE)}</span>
          )}
          {entry.trusted === true && (
            <span className="buff-settings-note">{t("From the project; you confirmed it.")}</span>
          )}
          {!entry.enabled && <span className="buff-settings-note">{t("Turned off: does not run.")}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {entry.trusted === false && (
          <Button size="sm" data-action="buff-hook-review" onClick={() => void review()}>
            {t("Check")}
          </Button>
        )}
        {entry.trusted === true && (
          <Button
            variant="ghost"
            size="sm"
            data-action="buff-hook-distrust"
            onClick={() => void props.controller.distrust(entry)}
          >
            {t("Revoke trust")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          data-action="buff-hook-edit"
          onClick={() =>
            dialog.show((close) => (
              <HookDialog controller={props.controller} scopes={props.scopes} entry={entry} onClose={close} />
            ))
          }
        >
          {t("Edit")}
        </Button>
        <Button variant="ghost" size="sm" data-action="buff-hook-remove" onClick={remove}>
          {t("Delete")}
        </Button>
        <Switch
          aria-label={entry.id}
          checked={entry.enabled}
          onCheckedChange={(enabled) => void props.controller.enable(entry, enabled)}
        />
      </div>
    </div>
  )
}

/** `scopes` — where hooks can be added here; the first is offered by default. */
export function BuffHookSection(props: { server: Server; directory?: string; scopes: readonly BuffHook.Scope[] }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const controller = useHookController(props.server, props.directory)
  return (
    <div className="flex flex-col gap-6" data-component="buff-hook-section">
      <div className="flex items-start justify-between gap-4">
        <span className="ui-note">{t(BuffHook.ABOUT)}</span>
        <Button
          size="sm"
          leadingIcon={Plus}
          className="shrink-0"
          data-action="buff-hook-add"
          onClick={() =>
            dialog.show((close) => <HookDialog controller={controller} scopes={props.scopes} onClose={close} />)
          }
        >
          {t("Create hook")}
        </Button>
      </div>
      <Problem text={controller.problem} />
      <SettingsList>
        <BuffTrustPolicyRow server={props.server} />
      </SettingsList>
      {props.scopes.map((scope) => {
        const hooks = controller.entries.filter((entry) => entry.scope === scope)
        return (
          <div key={scope} className="settings-section">
            <span className="settings-section-title">{t(GROUP_TITLE[scope])}</span>
            {hooks.length === 0 && <span className="ui-note">{t(GROUP_EMPTY[scope])}</span>}
            {hooks.length > 0 && (
              <Panel data-component="settings-list" data-variant="catalog">
                {hooks.map((entry) => (
                  <HookRow key={entry.id} entry={entry} controller={controller} scopes={props.scopes} />
                ))}
              </Panel>
            )}
          </div>
        )
      })}
    </div>
  )
}
