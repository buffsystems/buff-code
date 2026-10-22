// Commands and subagents in settings (#446), ported from the Solid window's buff/custom-settings.tsx:
// create, edit, delete, switch on and off — without editing files by hand. One page for both kinds:
// how they differ (form fields, words) is in the kind's description (BuffCustom.kinds). Others'
// entries (built in, from the settings file) are shown and can be switched off, not edited. A
// project's entry runs only after its text was checked and trusted here.

import "./settings.css"
import { Button, Field, Input, Panel, SelectMenu, Switch, Textarea } from "@buff/ui/react"
import { originGroups } from "@opencode/app/react-reuse/origin-groups"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffCustom } from "@opencode/schema/buff-custom"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import type { Server } from "../../core/servers"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { showToast } from "../../shell/notifications/toast"
import { Choice, FormDialog, Hint, Problem, ReviewDialog } from "./kit"
import { at, useBuffList } from "./rpc"

const SCOPE_OPTIONS = [
  { value: "project", label: "In the project" },
  { value: "user", label: "On my machine — for all projects" },
] as const
const READ_ONLY: readonly BuffCustom.Origin[] = ["config", "builtin"]
/** The «session model» option: the select takes no empty value, the file gets an empty one. */
const SESSION_MODEL = "session"

type Content = { values: Record<string, string>; body: string }
type Controller = ReturnType<typeof useCustomController>

const ownScope = (scope: BuffCustom.Origin): BuffCustom.Scope | undefined =>
  scope === "user" || scope === "project" ? scope : undefined

function useCustomController(server: Server, kind: BuffCustom.Kind, directory: string | undefined) {
  const t = useI18n().buff.t
  const rpc = server.api().rpc(BuffCustom.Rpc)
  const list = useBuffList<readonly BuffCustom.Entry[]>({
    server,
    name: `custom-${kind.name}`,
    directory,
    empty: [],
    load: () => rpc.list({ kind: kind.name }, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
    failure: t("Could not get the list."),
  })
  const failed = (error: unknown) =>
    showToast({ title: t(kind.words.title), description: formatServerError(error, undefined, t("Could not save.")) })
  const target = (entry: BuffCustom.Entry, scope: BuffCustom.Scope) => ({ kind: kind.name, scope, id: entry.id })
  return {
    server,
    directory,
    kind,
    problem: list.problem,
    entries: list.value,
    read: (entry: BuffCustom.Entry, scope: BuffCustom.Scope) => rpc.read(target(entry, scope), at(directory)),
    save: (scope: BuffCustom.Scope, id: string, content: Content, previous?: { scope: BuffCustom.Scope; id: string }) =>
      rpc
        .save({ kind: kind.name, scope, id, ...content, ...(previous ? { previous } : {}) }, at(directory))
        .then(list.settle),
    remove: (entry: BuffCustom.Entry, scope: BuffCustom.Scope) =>
      rpc.remove(target(entry, scope), at(directory)).then(list.settle, failed),
    review: (entry: BuffCustom.Entry) => rpc.review({ kind: kind.name, id: entry.id }, at(directory)),
    /** Confirm what was reviewed; a string says why it did not work. */
    trust: (entry: BuffCustom.Entry, token: string) =>
      rpc.trust({ kind: kind.name, id: entry.id, token }, at(directory)).then(
        () => {
          list.settle()
          return undefined
        },
        (error: unknown) => formatServerError(error, undefined, t("Could not confirm.")),
      ),
    distrust: (entry: BuffCustom.Entry) =>
      rpc.trust({ kind: kind.name, id: entry.id }, at(directory)).then(list.settle, failed),
    enable: (entry: BuffCustom.Entry, enabled: boolean) =>
      rpc.enable({ kind: kind.name, id: entry.id, enabled }, at(directory)).then(list.settle, failed),
  }
}

/** The «Model» field: the server's models; one written by hand but not available stays listed. */
function ModelField(props: {
  controller: Controller
  field: BuffCustom.Field
  value: string
  onChange: (value: string) => void
}) {
  const t = useI18n().buff.t
  const server = props.controller.server
  const connected = useConnection(server).status === "connected"
  const location = props.controller.directory ? { directory: props.controller.directory } : undefined
  const models = useQuery({
    queryKey: ["buff-custom-models", server.key, props.controller.directory ?? ""],
    enabled: connected,
    queryFn: () => server.api().model.list({ location }),
  })
  const known = (models.data?.data ?? [])
    .map((model) => ({ value: `${model.providerID}/${model.modelID}`, label: model.name }))
    .toSorted((a, b) => a.label.localeCompare(b.label))
  const missing = props.value && !known.some((option) => option.value === props.value)
  const options = [
    { value: SESSION_MODEL, label: t("Session model") },
    ...(missing ? [{ value: props.value, label: props.value }] : []),
    ...known,
  ]
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="ui-label">{t(props.field.label)}</span>
      <div data-action={`buff-custom-${props.field.key}`}>
        <SelectMenu
          aria-label={t(props.field.label)}
          value={props.value || SESSION_MODEL}
          options={options}
          onValueChange={(value) => props.onChange(value === SESSION_MODEL ? "" : value)}
        />
      </div>
    </div>
  )
}

function FieldInput(props: {
  controller: Controller
  field: BuffCustom.Field
  value: string
  onChange: (value: string) => void
}) {
  const t = useI18n().buff.t
  const field = props.field
  if (field.model) return <ModelField {...props} />
  const hint = field.hint ? t(field.hint) : undefined
  if (field.options) {
    const options = field.options.map((option) => ({ ...option, label: t(option.label) }))
    return (
      <Field group label={t(field.label)} hint={hint}>
        <Choice value={props.value || (options[0]?.value ?? "")} options={options} onPick={props.onChange} />
      </Field>
    )
  }
  return (
    <Field label={t(field.label)} hint={hint}>
      <Input
        value={props.value}
        placeholder={field.placeholder ? t(field.placeholder) : undefined}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </Field>
  )
}

function EntryDialog(props: {
  controller: Controller
  scopes: readonly BuffCustom.Scope[]
  entry?: BuffCustom.Entry
  content?: Content
  onClose: () => void
}) {
  const t = useI18n().buff.t
  const kind = props.controller.kind
  const stored = props.entry
  const storedScope = stored ? ownScope(stored.scope) : undefined
  const [form, setForm] = useState({
    id: stored?.id ?? "",
    values: BuffCustom.formValues(kind, props.content?.values),
    body: props.content?.body ?? "",
    scope: storedScope ?? props.scopes[0] ?? "user",
  })
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const edit = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }))
    setProblem(undefined)
  }
  const save = async () => {
    const draft = { id: form.id.trim(), values: { ...form.values }, body: form.body }
    const invalid = BuffCustom.problem(kind, draft, t)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    const previous = stored && storedScope ? { scope: storedScope, id: stored.id } : undefined
    await props.controller
      .save(form.scope, draft.id, draft, previous)
      .then(props.onClose, (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))))
    setSaving(false)
  }
  return (
    <FormDialog
      title={stored ? kind.words.edit(stored.id, t) : t(kind.words.created)}
      name="buff-custom-form"
      action={t(stored ? "Save" : "Create")}
      actionTarget="buff-custom-save"
      busy={saving}
      onClose={props.onClose}
      onSubmit={() => void save()}
    >
      <Field label={t("Short name")} hint={t(kind.idHint)}>
        <Input
          value={form.id}
          placeholder={kind.idPlaceholder}
          onChange={(event) => edit({ id: event.currentTarget.value })}
        />
      </Field>
      {kind.fields.map((field) => (
        <FieldInput
          key={field.key}
          controller={props.controller}
          field={field}
          value={form.values[field.key] ?? ""}
          onChange={(value) => edit({ values: { ...form.values, [field.key]: value } })}
        />
      ))}
      <Field label={t(kind.body.label)}>
        <Textarea
          rows={9}
          className="font-mono"
          value={form.body}
          placeholder={t(kind.body.placeholder)}
          onChange={(event) => edit({ body: event.currentTarget.value })}
        />
      </Field>
      <Hint>{t(kind.body.hint)}</Hint>
      {props.scopes.length > 1 && (
        <Field group label={t("Where to keep")} hint={t(kind.words.scopeNote[form.scope])}>
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

/** What to say about an entry under its description: the chosen options and the model. */
function meta(kind: BuffCustom.Kind, entry: BuffCustom.Entry, t: BuffI18n.T) {
  return kind.fields
    .flatMap((field) => {
      const value = entry.values[field.key]
      if (!value || field.key === "description") return []
      const option = field.options?.find((item) => item.value === value)
      return [option ? t(option.label).split(" — ")[0] : `${t(field.label).toLowerCase()}: ${value}`]
    })
    .join(" · ")
}

function EntryRow(props: { entry: BuffCustom.Entry; controller: Controller; scopes: readonly BuffCustom.Scope[] }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const kind = props.controller.kind
  const entry = props.entry
  const scope = ownScope(entry.scope)
  const details = meta(kind, entry, t)
  const opened = (error: unknown) => {
    showToast({ title: t(kind.words.title), description: formatServerError(error, undefined, t("Could not open.")) })
    return undefined
  }
  const edit = async (own: BuffCustom.Scope) => {
    const content = await props.controller.read(entry, own).catch(opened)
    if (!content) return
    dialog.show((close) => (
      <EntryDialog
        controller={props.controller}
        scopes={props.scopes}
        entry={entry}
        content={content}
        onClose={close}
      />
    ))
  }
  const review = async () => {
    const reviewed = await props.controller.review(entry).catch(opened)
    if (!reviewed) return
    dialog.show((close) => (
      <ReviewDialog
        title={t("Trust {name}?", { name: BuffCustom.mention(kind, entry.id) })}
        intro={t(
          "This entry came from the project. Check its text: inserts like !`command` run on your machine. If the text changes, you will be asked to confirm again.",
        )}
        text={reviewed.text}
        onClose={close}
        onConfirm={() => props.controller.trust(entry, reviewed.token)}
      />
    ))
  }
  const remove = (own: BuffCustom.Scope) =>
    void confirm(dialog, {
      title: kind.words.remove(entry.id, t),
      text: t("The file {file} will be deleted.", { file: entry.path ?? "" }),
      action: t("Delete"),
      cancel: t("Cancel"),
      danger: true,
    }).then((yes) => {
      if (yes) void props.controller.remove(entry, own)
    })
  return (
    <div
      className="buff-settings-row"
      data-component="buff-custom-row"
      data-entry={entry.id}
      data-trusted={entry.trusted}
    >
      <div className="buff-settings-lead">
        <div className={entry.enabled ? "buff-settings-copy" : "buff-settings-copy opacity-60"}>
          <span className="buff-settings-name truncate font-mono">{BuffCustom.mention(kind, entry.id)}</span>
          {/* #470: built-in descriptions come from the core in English — the catalog translates them. */}
          {entry.description && (
            <span className="buff-settings-note line-clamp-2" title={t(entry.description)}>
              {t(entry.description)}
            </span>
          )}
          {details && <span className="buff-settings-note">{details}</span>}
          {entry.scope === "config" && <span className="buff-settings-note">{t(kind.words.readOnly)}</span>}
          {!entry.enabled && <span className="buff-settings-note">{t(kind.words.disabled)}</span>}
          {entry.trusted === false && (
            <span className="buff-settings-note text-warning">{t(BuffCustom.UNTRUSTED_NOTE)}</span>
          )}
          {entry.trusted === true && (
            <span className="buff-settings-note">{t("From the project; you confirmed the text.")}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {entry.trusted === false && (
          <Button size="sm" data-action="buff-custom-review" onClick={() => void review()}>
            {t("Check")}
          </Button>
        )}
        {entry.trusted === true && (
          <Button
            variant="ghost"
            size="sm"
            data-action="buff-custom-distrust"
            onClick={() => void props.controller.distrust(entry)}
          >
            {t("Revoke trust")}
          </Button>
        )}
        {scope && (
          <>
            <Button variant="ghost" size="sm" data-action="buff-custom-edit" onClick={() => void edit(scope)}>
              {t("Edit")}
            </Button>
            <Button variant="ghost" size="sm" data-action="buff-custom-remove" onClick={() => remove(scope)}>
              {t("Delete")}
            </Button>
          </>
        )}
        <Switch
          aria-label={entry.id}
          checked={entry.enabled}
          onCheckedChange={(enabled) => void props.controller.enable(entry, enabled)}
        />
      </div>
    </div>
  )
}

/** `scopes` — where entries can be added here; the first is offered by default. */
export function BuffCustomSection(props: {
  server: Server
  kind: BuffCustom.KindName
  directory?: string
  scopes: readonly BuffCustom.Scope[]
}) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const kind = BuffCustom.kinds[props.kind]
  const controller = useCustomController(props.server, kind, props.directory)
  const [query, setQuery] = useState("")
  const groups = originGroups(controller.entries, query, [...props.scopes, ...READ_ONLY], props.scopes, (entry) => [
    entry.id,
    entry.description ?? "",
  ])
  return (
    <div className="flex flex-col gap-6" data-component="buff-custom-section" data-kind={kind.name}>
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          value={query}
          aria-label={t(kind.words.search)}
          placeholder={t(kind.words.search)}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Button
          size="sm"
          leadingIcon={Plus}
          data-action="buff-custom-add"
          onClick={() =>
            dialog.show((close) => <EntryDialog controller={controller} scopes={props.scopes} onClose={close} />)
          }
        >
          {t(kind.words.create)}
        </Button>
      </div>
      <Problem text={controller.problem} />
      {groups.length === 0 && <span className="ui-note">{t("Nothing found for «{query}».", { query })}</span>}
      {groups.map((group) => {
        const scope = ownScope(group.scope)
        return (
          <div key={group.scope} className="settings-section">
            <span className="settings-section-title">{t(kind.words.groups[group.scope])}</span>
            {group.items.length === 0 && scope && <span className="ui-note">{t(kind.words.empty[scope])}</span>}
            {group.items.length > 0 && (
              <Panel data-component="settings-list" data-variant="catalog">
                {group.items.map((entry) => (
                  <EntryRow
                    key={`${entry.scope}:${entry.id}`}
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
