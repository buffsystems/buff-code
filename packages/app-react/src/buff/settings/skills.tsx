// Skills in settings (#445), ported from the Solid window's buff/skill-settings.tsx: create, edit,
// delete, switch on and off, attach a directory of skills — without editing files by hand. Server
// settings show the person's skills, project settings the project's too. Others' skills (attached,
// built in) are shown and can be switched off, not edited.

import "./settings.css"
import { Button, Field, Input, Panel, Switch, Textarea } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { skillGroups } from "@opencode/app/react-reuse/skill-list"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { Plus } from "lucide-react"
import { useState } from "react"
import type { Server } from "../../core/servers"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { Choice, FormDialog, Hint, Problem } from "./kit"
import { at, useBuffList } from "./rpc"

const GROUP_TITLE: Record<BuffSkill.Origin, string> = {
  project: "Project skills",
  user: "Your skills — in all projects",
  external: "Attached skills",
  builtin: "Built-in skills",
}
const GROUP_EMPTY: Record<BuffSkill.Origin, string> = {
  project: "This project has no skills of its own.",
  user: "No skills of your own yet.",
  external: "",
  builtin: "",
}
const SCOPE_OPTIONS = [
  { value: "project", label: "In the project" },
  { value: "user", label: "On my machine — for all projects" },
] as const
const SKILL_NOTE: Record<BuffSkill.Scope, string> = {
  project: "The skill goes to the project's .buffcode directory and to the repository — the whole team gets the skill.",
  user: "The skill stays on this machine, in your configuration.",
}
const ATTACH_NOTE: Record<BuffSkill.Scope, string> = {
  project:
    "The attachment entry goes to the project's .buffcode directory and to the repository — the whole team gets the skill.",
  user: "The attachment entry stays on this machine, in your configuration.",
}

type Draft = { id: string; name: string; description: string; body: string; scope: BuffSkill.Scope }
type Controller = ReturnType<typeof useSkillController>

const ownScope = (scope: BuffSkill.Origin): BuffSkill.Scope | undefined =>
  scope === "user" || scope === "project" ? scope : undefined

function useSkillController(server: Server, directory: string | undefined) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const rpc = server.api().rpc(BuffSkill.Rpc)
  const empty: { skills: readonly BuffSkill.Entry[]; sources: readonly BuffSkill.Source[] } = {
    skills: [],
    sources: [],
  }
  // The core reads skill files again a moment later — the list is read once more after it.
  const list = useBuffList({
    server,
    name: "skills",
    directory,
    empty,
    load: () => rpc.list(undefined, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
    delays: [1500],
  })
  const failed = (error: unknown) =>
    showToast({ title: t("Skills"), description: formatServerError(error, undefined, t("Could not save.")) })
  return {
    skills: list.value.skills,
    sources: list.value.sources,
    read: (entry: BuffSkill.Entry, scope: BuffSkill.Scope) => rpc.read({ scope, id: entry.id }, at(directory)),
    save: (draft: Draft, previous?: { scope: BuffSkill.Scope; id: string }) =>
      rpc.save({ ...draft, ...(previous ? { previous } : {}) }, at(directory)).then(list.settle),
    remove: (entry: BuffSkill.Entry, scope: BuffSkill.Scope) =>
      rpc.remove({ scope, id: entry.id }, at(directory)).then(list.settle, failed),
    enable: (entry: BuffSkill.Entry, enabled: boolean) =>
      rpc.enable({ id: entry.id, enabled }, at(directory)).then(list.settle, failed),
    attach: (scope: BuffSkill.Scope, source: string, attached: boolean) =>
      rpc.attach({ scope, source, attached }, at(directory)).then(list.settle),
  }
}

function ScopeChoice(props: {
  scopes: readonly BuffSkill.Scope[]
  value: BuffSkill.Scope
  label: string
  note: string
  onPick: (scope: BuffSkill.Scope) => void
}) {
  const t = useI18n().buff.t
  if (props.scopes.length < 2) return null
  return (
    <Field group label={props.label} hint={props.note}>
      <Choice
        value={props.value}
        options={SCOPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
        onPick={props.onPick}
      />
    </Field>
  )
}

function SkillDialog(props: {
  controller: Controller
  scopes: readonly BuffSkill.Scope[]
  entry?: BuffSkill.Entry
  parts?: { name: string; description: string; body: string }
  onClose: () => void
}) {
  const t = useI18n().buff.t
  const stored = props.entry
  const storedScope = stored ? ownScope(stored.scope) : undefined
  const [form, setForm] = useState<Draft>({
    id: stored?.id ?? "",
    name: props.parts?.name ?? "",
    description: props.parts?.description ?? "",
    body: props.parts?.body ?? "",
    scope: storedScope ?? props.scopes[0] ?? "user",
  })
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const edit = (patch: Partial<Draft>) => {
    setForm((current) => ({ ...current, ...patch }))
    setProblem(undefined)
  }
  const save = async () => {
    const draft = { ...form, id: form.id.trim() }
    const invalid = BuffSkill.problem(draft, t)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    const previous = stored && storedScope ? { scope: storedScope, id: stored.id } : undefined
    await props.controller
      .save(draft, previous)
      .then(props.onClose, (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))))
    setSaving(false)
  }
  return (
    <FormDialog
      title={stored ? t("Skill «{name}»", { name: stored.name }) : t("New skill")}
      name="buff-skill-form"
      action={t(stored ? "Save" : "Create")}
      actionTarget="buff-skill-save"
      busy={saving}
      onClose={props.onClose}
      onSubmit={() => void save()}
    >
      <Field
        label={t("ID")}
        hint={t(
          "Lowercase Latin letters, digits and hyphen. The skill is called by it in the input field: @release-notes.",
        )}
      >
        <Input
          value={form.id}
          placeholder="release-notes"
          onChange={(event) => edit({ id: event.currentTarget.value })}
        />
      </Field>
      <Field label={t("Name")}>
        <Input
          value={form.name}
          placeholder={t("Release notes")}
          onChange={(event) => edit({ name: event.currentTarget.value })}
        />
      </Field>
      <Field
        label={t("When to use")}
        hint={t("By this description the model decides by itself whether the skill is needed.")}
      >
        <Textarea
          rows={3}
          value={form.description}
          placeholder={t("When asked to write release notes or a list of changes")}
          onChange={(event) => edit({ description: event.currentTarget.value })}
        />
      </Field>
      <Field label={t("Instruction")} hint={t("What to do when the skill is used. Plain text in Markdown.")}>
        <Textarea
          rows={9}
          className="font-mono"
          value={form.body}
          placeholder={`${t("# How to write the notes")}\n\n1. ${t("Collect the changes since the last release.")}\n2. ${t("Group them by section.")}`}
          onChange={(event) => edit({ body: event.currentTarget.value })}
        />
      </Field>
      <ScopeChoice
        scopes={props.scopes}
        value={form.scope}
        label={t("Where to keep")}
        note={t(SKILL_NOTE[form.scope])}
        onPick={(scope) => edit({ scope })}
      />
      <Problem text={problem} />
    </FormDialog>
  )
}

function AttachDialog(props: { controller: Controller; scopes: readonly BuffSkill.Scope[]; onClose: () => void }) {
  const t = useI18n().buff.t
  const [source, setSource] = useState("")
  const [scope, setScope] = useState<BuffSkill.Scope>(props.scopes[0] ?? "user")
  const [problem, setProblem] = useState<string>()
  const attach = async () => {
    const invalid = BuffSkill.sourceProblem(source, t)
    if (invalid) return setProblem(invalid)
    await props.controller
      .attach(scope, source, true)
      .then(props.onClose, (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not attach."))))
  }
  return (
    <FormDialog
      title={t("Attach skills")}
      name="buff-skill-attach"
      action={t("Attach")}
      actionTarget="buff-skill-attach-save"
      size="md"
      onClose={props.onClose}
      onSubmit={() => void attach()}
    >
      <Field
        label={t("Directory or address")}
        hint={t(
          "A directory with skills on this machine (with folders holding a SKILL.md file) or an address where the skills are published. Another agent's skills directory will do too.",
        )}
      >
        <Input
          value={source}
          placeholder="~/team-skills"
          onChange={(event) => {
            setSource(event.currentTarget.value)
            setProblem(undefined)
          }}
        />
      </Field>
      <ScopeChoice
        scopes={props.scopes}
        value={scope}
        label={t("For whom")}
        note={t(ATTACH_NOTE[scope])}
        onPick={setScope}
      />
      <Problem text={problem} />
    </FormDialog>
  )
}

function SkillRow(props: { entry: BuffSkill.Entry; controller: Controller; scopes: readonly BuffSkill.Scope[] }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const scope = ownScope(props.entry.scope)
  const edit = async (own: BuffSkill.Scope) => {
    const parts = await props.controller.read(props.entry, own).catch((error: unknown) => {
      showToast({
        title: t("Skills"),
        description: formatServerError(error, undefined, t("Could not open the skill.")),
      })
      return undefined
    })
    if (!parts) return
    dialog.show((close) => (
      <SkillDialog
        controller={props.controller}
        scopes={props.scopes}
        entry={props.entry}
        parts={parts}
        onClose={close}
      />
    ))
  }
  const remove = (own: BuffSkill.Scope) =>
    void confirm(dialog, {
      title: t("Delete the skill «{name}»?", { name: props.entry.name }),
      text: t("The skill file {file} will be deleted together with its directory.", { file: props.entry.path ?? "" }),
      action: t("Delete"),
      cancel: t("Cancel"),
      danger: true,
    }).then((yes) => {
      if (yes) void props.controller.remove(props.entry, own)
    })
  return (
    <div className="buff-settings-row" data-component="buff-skill-row" data-skill={props.entry.id}>
      <div className="buff-settings-lead">
        <div className={props.entry.enabled ? "buff-settings-copy" : "buff-settings-copy opacity-60"}>
          <span className="buff-settings-name truncate">
            {props.entry.name}
            {props.entry.name !== props.entry.id && (
              <span className="buff-settings-note font-mono"> @{props.entry.id}</span>
            )}
          </span>
          <span className="buff-settings-note">
            {props.entry.description ??
              t("No description: the model will not pick such a skill by itself — only when called with @.")}
          </span>
          {!props.entry.enabled && (
            <span className="buff-settings-note">
              {t("Turned off: the model does not see it, it is not in the suggestions.")}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {scope && (
          <>
            <Button variant="ghost" size="sm" data-action="buff-skill-edit" onClick={() => void edit(scope)}>
              {t("Edit")}
            </Button>
            <Button variant="ghost" size="sm" data-action="buff-skill-remove" onClick={() => remove(scope)}>
              {t("Delete")}
            </Button>
          </>
        )}
        <Switch
          aria-label={props.entry.name}
          checked={props.entry.enabled}
          onCheckedChange={(enabled) => void props.controller.enable(props.entry, enabled)}
        />
      </div>
    </div>
  )
}

/** `scopes` — where skills can be added here; the first is offered by default. */
export function BuffSkillSection(props: { server: Server; directory?: string; scopes: readonly BuffSkill.Scope[] }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const controller = useSkillController(props.server, props.directory)
  const [query, setQuery] = useState("")
  const groups = skillGroups(controller.skills, query, props.scopes)
  const sources = controller.sources.filter((source) => props.scopes.includes(source.scope))
  const detach = (source: BuffSkill.Source) =>
    void controller
      .attach(source.scope, source.source, false)
      .catch((error: unknown) =>
        showToast({ title: t("Skills"), description: formatServerError(error, undefined, t("Could not detach.")) }),
      )

  return (
    <div className="flex flex-col gap-6" data-component="buff-skill-section">
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          value={query}
          aria-label={t("Search skills")}
          placeholder={t("Search by title and description")}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Button
          size="sm"
          data-action="buff-skill-attach"
          onClick={() =>
            dialog.show((close) => <AttachDialog controller={controller} scopes={props.scopes} onClose={close} />)
          }
        >
          {t("Attach a directory")}
        </Button>
        <Button
          size="sm"
          leadingIcon={Plus}
          data-action="buff-skill-add"
          onClick={() =>
            dialog.show((close) => <SkillDialog controller={controller} scopes={props.scopes} onClose={close} />)
          }
        >
          {t("Create skill")}
        </Button>
      </div>
      {groups.length === 0 && <span className="ui-note">{t("Nothing found for «{query}».", { query })}</span>}
      {groups.map((group) => (
        <div key={group.scope} className="settings-section">
          <span className="settings-section-title">{t(GROUP_TITLE[group.scope])}</span>
          {group.skills.length === 0 && <span className="ui-note">{t(GROUP_EMPTY[group.scope])}</span>}
          {group.skills.length > 0 && (
            <Panel data-component="settings-list" data-variant="catalog">
              {group.skills.map((entry) => (
                <SkillRow key={entry.id} entry={entry} controller={controller} scopes={props.scopes} />
              ))}
            </Panel>
          )}
        </div>
      ))}
      {sources.length > 0 && (
        <div className="settings-section">
          <span className="settings-section-title">{t("Where skills are attached from")}</span>
          <Panel data-component="settings-list" data-variant="catalog">
            {sources.map((source) => (
              <div
                key={`${source.scope}:${source.source}`}
                className="buff-settings-row"
                data-component="buff-skill-source"
              >
                <div className="buff-settings-lead">
                  <div className="buff-settings-copy">
                    <span className="buff-settings-name truncate font-mono">{source.source}</span>
                    <span className="buff-settings-note">
                      {t(source.scope === "project" ? "attached in the project" : "attached by you")}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" data-action="buff-skill-detach" onClick={() => detach(source)}>
                  {t("Detach")}
                </Button>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  )
}
