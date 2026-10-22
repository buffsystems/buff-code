import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"
import { Choice, ConfirmDialog, FormBody, Hint, Problem } from "./settings-kit"
import { skillGroups } from "./skill-list"
import { createSkillState } from "./skill-state"

/**
 * Навыки в настройках (#445): создать, поправить, удалить, включить и выключить, подключить
 * каталог с навыками — без правки файлов руками. Настройки сервера показывают навыки
 * пользователя, настройки проекта — ещё и навыки проекта. Чужие навыки (подключённые,
 * встроенные) видны и выключаются, но не правятся.
 */

const GROUP_TITLE: Record<BuffSkill.Origin, string> = {
  project: "Project skills",
  user: "Your skills — in all projects",
  external: "Attached skills",
  builtin: "Built-in skills",
}
const GROUP_EMPTY: Record<BuffSkill.Scope, string> = {
  project: "This project has no skills of its own.",
  user: "No skills of your own yet.",
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

type Controller = ReturnType<typeof createController>
type Draft = { id: string; name: string; description: string; body: string; scope: BuffSkill.Scope }

function createController(directory: Accessor<string | undefined>) {
  const { rpc, at, settle, skills, sources } = createSkillState(directory)
  const { t } = useBuffText()
  const failed = (error: unknown) =>
    showToast({ title: t("Skills"), description: formatServerError(error, undefined, t("Could not save.")) })

  return {
    skills,
    sources,
    read: (entry: BuffSkill.Entry) => rpc.read({ scope: entry.scope as BuffSkill.Scope, id: entry.id }, at()),
    save: (draft: Draft, previous?: { scope: BuffSkill.Scope; id: string }) =>
      rpc.save({ ...draft, ...(previous ? { previous } : {}) }, at()).then(settle),
    remove: (entry: BuffSkill.Entry) =>
      rpc.remove({ scope: entry.scope as BuffSkill.Scope, id: entry.id }, at()).then(settle, failed),
    enable: (entry: BuffSkill.Entry, enabled: boolean) =>
      rpc.enable({ id: entry.id, enabled }, at()).then(settle, failed),
    attach: (scope: BuffSkill.Scope, source: string, attached: boolean) =>
      rpc.attach({ scope, source, attached }, at()).then(settle),
  }
}

function SkillDialog(props: {
  controller: Controller
  scopes: readonly BuffSkill.Scope[]
  entry?: BuffSkill.Entry
  parts?: { name: string; description: string; body: string }
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const stored = props.entry
  const [form, setForm] = createStore<Draft>({
    id: stored?.id ?? "",
    name: props.parts?.name ?? "",
    description: props.parts?.description ?? "",
    body: props.parts?.body ?? "",
    scope: (stored?.scope as BuffSkill.Scope | undefined) ?? props.scopes[0],
  })
  const [problem, setProblem] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const edit = (field: "id" | "name" | "description" | "body", value: string) => {
    setForm(field, value)
    setProblem(undefined)
  }

  const save = async () => {
    const draft = { ...form, id: form.id.trim() }
    const invalid = BuffSkill.problem(draft, t)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    const previous = stored ? { scope: stored.scope as BuffSkill.Scope, id: stored.id } : undefined
    await props.controller.save(draft, previous).then(
      () => dialog.close(),
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))),
    )
    setSaving(false)
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{stored ? t("Skill «{name}»", { name: stored.name }) : t("New skill")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-skill-form">
          <TextField
            label={t("ID")}
            placeholder="release-notes"
            value={form.id}
            onChange={(value) => edit("id", value)}
          />
          <Hint>
            {t(
              "Lowercase Latin letters, digits and hyphen. The skill is called by it in the input field: @release-notes.",
            )}
          </Hint>
          <TextField
            label={t("Name")}
            placeholder={t("Release notes")}
            value={form.name}
            onChange={(value) => edit("name", value)}
          />
          <TextField
            multiline
            label={t("When to use")}
            class="buff-kit-area"
            placeholder={t("When asked to write release notes or a list of changes")}
            value={form.description}
            onChange={(value) => edit("description", value)}
          />
          <Hint>{t("By this description the model decides by itself whether the skill is needed.")}</Hint>
          <TextField
            multiline
            label={t("Instruction")}
            class="buff-kit-area buff-kit-area--tall font-mono"
            placeholder={`${t("# How to write the notes")}\n\n1. ${t("Collect the changes since the last release.")}\n2. ${t("Group them by section.")}`}
            value={form.body}
            onChange={(value) => edit("body", value)}
          />
          <Hint>{t("What to do when the skill is used. Plain text in Markdown.")}</Hint>
          <Show when={props.scopes.length > 1}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-weak">{t("Where to keep")}</span>
              <Choice
                value={form.scope}
                options={SCOPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                onPick={(value) => setForm("scope", value)}
              />
              <span class="text-12-regular text-text-weak">{t(SKILL_NOTE[form.scope])}</span>
            </div>
          </Show>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-skill-save" disabled={saving()} onClick={() => void save()}>
          {t(stored ? "Save" : "Create")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function AttachDialog(props: { controller: Controller; scopes: readonly BuffSkill.Scope[] }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const [form, setForm] = createStore({ source: "", scope: props.scopes[0] })
  const [problem, setProblem] = createSignal<string>()

  const attach = async () => {
    const invalid = BuffSkill.sourceProblem(form.source, t)
    if (invalid) return setProblem(invalid)
    await props.controller.attach(form.scope, form.source, true).then(
      () => dialog.close(),
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not attach."))),
    )
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{t("Attach skills")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-skill-attach">
          <TextField
            label={t("Directory or address")}
            placeholder="~/team-skills"
            value={form.source}
            onChange={(value) => {
              setForm("source", value)
              setProblem(undefined)
            }}
          />
          <Hint>
            {t(
              "A directory with skills on this machine (with folders holding a SKILL.md file) or an address where the skills are published. Another agent's skills directory will do too.",
            )}
          </Hint>
          <Show when={props.scopes.length > 1}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-weak">{t("For whom")}</span>
              <Choice
                value={form.scope}
                options={SCOPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                onPick={(value) => setForm("scope", value)}
              />
              <span class="text-12-regular text-text-weak">{t(ATTACH_NOTE[form.scope])}</span>
            </div>
          </Show>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-skill-attach-save" onClick={() => void attach()}>
          {t("Attach")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function SkillRow(props: { entry: BuffSkill.Entry; controller: Controller; scopes: readonly BuffSkill.Scope[] }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const own = () => props.entry.scope === "user" || props.entry.scope === "project"
  const edit = async () => {
    const parts = await props.controller.read(props.entry).catch((error: unknown) => {
      showToast({
        title: t("Skills"),
        description: formatServerError(error, undefined, t("Could not open the skill.")),
      })
      return undefined
    })
    if (parts)
      void dialog.show(() => (
        <SkillDialog controller={props.controller} scopes={props.scopes} entry={props.entry} parts={parts} />
      ))
  }
  return (
    <div class="settings-extension-row" data-component="buff-skill-row" data-skill={props.entry.id}>
      <div class="settings-extension-lead">
        <div class="buff-kit-copy" classList={{ "opacity-60": !props.entry.enabled }}>
          <span class="settings-extension-name truncate">
            {props.entry.name}
            <Show when={props.entry.name !== props.entry.id}>
              <span class="buff-kit-note font-mono"> @{props.entry.id}</span>
            </Show>
          </span>
          <span class="buff-kit-note">
            {props.entry.description ??
              t("No description: the model will not pick such a skill by itself — only when called with @.")}
          </span>
          <Show when={!props.entry.enabled}>
            <span class="buff-kit-note">
              {t("Turned off: the model does not see it, it is not in the suggestions.")}
            </span>
          </Show>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={own()}>
          <Button size="small" variant="ghost" data-action="buff-skill-edit" onClick={() => void edit()}>
            {t("Edit")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-skill-remove"
            onClick={() =>
              void dialog.show(() => (
                <ConfirmDialog
                  title={t("Delete the skill «{name}»?", { name: props.entry.name })}
                  text={t("The skill file {file} will be deleted together with its directory.", {
                    file: props.entry.path ?? "",
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
        <Switch
          checked={props.entry.enabled}
          onChange={(enabled) => void props.controller.enable(props.entry, enabled)}
          hideLabel
        >
          {props.entry.name}
        </Switch>
      </div>
    </div>
  )
}

/** `scopes` — области, в которые здесь можно добавлять; первая предлагается по умолчанию. */
export function BuffSkillSection(props: {
  directory: Accessor<string | undefined>
  scopes: readonly BuffSkill.Scope[]
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const controller = createController(props.directory)
  const [query, setQuery] = createSignal("")
  const groups = createMemo(() => skillGroups(controller.skills(), query(), props.scopes))
  const sources = createMemo(() => controller.sources().filter((source) => props.scopes.includes(source.scope)))

  return (
    <div class="flex flex-col gap-6" data-component="buff-skill-section">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <TextField
            hideLabel
            label={t("Search skills")}
            placeholder={t("Search by title and description")}
            value={query()}
            onChange={setQuery}
          />
        </div>
        <Button
          size="small"
          variant="neutral"
          data-action="buff-skill-attach"
          onClick={() => void dialog.show(() => <AttachDialog controller={controller} scopes={props.scopes} />)}
        >
          {t("Attach a directory")}
        </Button>
        <Button
          size="small"
          variant="neutral"
          icon="plus"
          data-action="buff-skill-add"
          onClick={() => void dialog.show(() => <SkillDialog controller={controller} scopes={props.scopes} />)}
        >
          {t("Create skill")}
        </Button>
      </div>
      <Show
        when={groups().length > 0}
        fallback={
          <span class="text-13-regular text-v2-text-text-muted">
            {t("Nothing found for «{query}».", { query: query() })}
          </span>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class="settings-section">
              <span class="settings-extension-heading text-13-medium">{t(GROUP_TITLE[group.scope])}</span>
              <Show
                when={group.skills.length > 0}
                fallback={
                  <span class="text-13-regular text-v2-text-text-muted">
                    {t(GROUP_EMPTY[group.scope as BuffSkill.Scope])}
                  </span>
                }
              >
                <SettingsList variant="catalog">
                  <For each={group.skills}>
                    {(entry) => <SkillRow entry={entry} controller={controller} scopes={props.scopes} />}
                  </For>
                </SettingsList>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={sources().length > 0}>
        <div class="settings-section">
          <span class="settings-extension-heading text-13-medium">{t("Where skills are attached from")}</span>
          <SettingsList variant="catalog">
            <For each={sources()}>
              {(source) => (
                <div class="settings-extension-row" data-component="buff-skill-source">
                  <div class="settings-extension-lead">
                    <div class="buff-kit-copy">
                      <span class="settings-extension-name truncate font-mono">{source.source}</span>
                      <span class="buff-kit-note">
                        {t(source.scope === "project" ? "attached in the project" : "attached by you")}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="ghost"
                    data-action="buff-skill-detach"
                    onClick={() =>
                      void controller.attach(source.scope, source.source, false).catch((error: unknown) =>
                        showToast({
                          title: t("Skills"),
                          description: formatServerError(error, undefined, t("Could not detach.")),
                        }),
                      )
                    }
                  >
                    {t("Detach")}
                  </Button>
                </div>
              )}
            </For>
          </SettingsList>
        </div>
      </Show>
    </div>
  )
}
