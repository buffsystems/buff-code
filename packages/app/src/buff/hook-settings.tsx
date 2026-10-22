import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffHook } from "@opencode/schema/buff-hook"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"
import { Choice, ConfirmDialog, FormBody, Hint, Problem, ReviewDialog } from "./settings-kit"
import { BuffTrustPolicyRow } from "./trust-policy"

/**
 * Хуки в настройках (#446): команда оболочки на событие агента — создать, поправить, удалить,
 * включить и выключить. Хук проекта не выполняется, пока его не проверили и не подтвердили
 * здесь же. Настройки сервера показывают хуки пользователя, настройки проекта — ещё и хуки
 * проекта.
 */

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

type Controller = ReturnType<typeof createController>
type Draft = { id: string; event: BuffHook.Event; tool: string; command: string; scope: BuffHook.Scope }

function createController(directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffHook.Rpc)
  const at = () => {
    const value = directory()
    return value ? { location: { directory: value } } : undefined
  }
  // Сбой загрузки — не «пусто»: причина показывается над списком.
  const [problem, setProblem] = createSignal<string>()
  const [entries, { refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? (directory() ?? "") : undefined),
    () =>
      rpc.list(undefined, at()).then(
        (list) => {
          setProblem(undefined)
          return list
        },
        (error: unknown) => {
          setProblem(formatServerError(error, undefined, t("Could not get the list.")))
          return [] as BuffHook.Entry[]
        },
      ),
    { initialValue: [] },
  )
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) void refetch()
    })().catch(() => undefined)
  })
  const settle = () => void refetch()
  const failed = (error: unknown) =>
    showToast({ title: t("Hooks"), description: formatServerError(error, undefined, t("Could not save.")) })
  const target = (entry: BuffHook.Entry) => ({ scope: entry.scope, id: entry.id })

  return {
    problem,
    failed,
    entries: () => entries.latest ?? [],
    save: (draft: Draft, previous?: { scope: BuffHook.Scope; id: string }) =>
      rpc.save({ ...draft, ...(previous ? { previous } : {}) }, at()).then(settle),
    remove: (entry: BuffHook.Entry) => rpc.remove(target(entry), at()).then(settle, failed),
    enable: (entry: BuffHook.Entry, enabled: boolean) =>
      rpc.enable({ ...target(entry), enabled }, at()).then(settle, failed),
    review: (entry: BuffHook.Entry) => rpc.review({ id: entry.id }, at()),
    /** Подтвердить просмотренное; строка — почему не вышло. */
    trust: (entry: BuffHook.Entry, token: string) =>
      rpc.trust({ id: entry.id, token }, at()).then(
        () => (settle(), undefined),
        (error: unknown) => formatServerError(error, undefined, t("Could not confirm.")),
      ),
    distrust: (entry: BuffHook.Entry) => rpc.trust({ id: entry.id }, at()).then(settle, failed),
  }
}

function HookDialog(props: { controller: Controller; scopes: readonly BuffHook.Scope[]; entry?: BuffHook.Entry }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const stored = props.entry
  const [form, setForm] = createStore<Draft>({
    id: stored?.id ?? "",
    event: stored?.event ?? "tool.after",
    tool: stored?.tool ?? "",
    command: stored?.command ?? "",
    scope: stored?.scope ?? props.scopes[0],
  })
  const [problem, setProblem] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const event = () => BuffHook.EVENTS.find((item) => item.value === form.event)!
  const edit = (change: Partial<Draft>) => {
    setForm(change)
    setProblem(undefined)
  }

  const save = async () => {
    const draft: Draft = { ...form, id: form.id.trim(), tool: event().tool ? form.tool : "" }
    const invalid = BuffHook.problem(draft, t)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    await props.controller.save(draft, stored ? { scope: stored.scope, id: stored.id } : undefined).then(
      () => dialog.close(),
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))),
    )
    setSaving(false)
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{stored ? t("Hook «{id}»", { id: stored.id }) : t("New hook")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-hook-form">
          <TextField
            label={t("Short name")}
            placeholder="format"
            value={form.id}
            onChange={(value) => edit({ id: value })}
          />
          <Hint>{t("Lowercase Latin letters, digits and hyphen.")}</Hint>
          <div class="flex flex-col gap-1.5">
            <span class="text-12-regular text-text-weak">{t("When to run")}</span>
            <Choice
              value={form.event}
              options={BuffHook.EVENTS.map((item) => ({ value: item.value, label: t(item.label) }))}
              onPick={(value) => edit({ event: value })}
            />
            <span class="text-12-regular text-text-weak">{t(event().hint)}</span>
          </div>
          <Show when={event().tool}>
            <TextField
              label={t("Tools")}
              placeholder="edit, write"
              value={form.tool}
              onChange={(value) => edit({ tool: value })}
            />
            <Hint>{t("Names separated by commas; an asterisk matches any ending (github_*). Empty — any tool.")}</Hint>
          </Show>
          <TextField
            multiline
            label={t("Command")}
            class="buff-kit-area font-mono"
            placeholder="bun run format"
            value={form.command}
            onChange={(value) => edit({ command: value })}
          />
          <Hint>
            {t(
              "Runs in the shell in the project directory, on your machine. The command gets the event as JSON: on standard input and in the BUFF_HOOK_EVENT variable.",
            )}
          </Hint>
          <Show when={props.scopes.length > 1}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-weak">{t("Where to keep")}</span>
              <Choice
                value={form.scope}
                options={SCOPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                onPick={(value) => edit({ scope: value })}
              />
              <span class="text-12-regular text-text-weak">{t(SCOPE_NOTE[form.scope])}</span>
            </div>
          </Show>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-hook-save" disabled={saving()} onClick={() => void save()}>
          {t(stored ? "Save" : "Create")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function HookRow(props: { entry: BuffHook.Entry; controller: Controller; scopes: readonly BuffHook.Scope[] }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const review = async () => {
    const reviewed = await props.controller.review(props.entry).catch((error: unknown) => {
      props.controller.failed(error)
      return undefined
    })
    if (reviewed)
      void dialog.show(() => (
        <ReviewDialog
          title={t("Trust the hook «{id}»?", { id: props.entry.id })}
          intro={t(
            "This hook came from the project. Its command will run by itself on your machine, outside the sandbox. If the hook changes, you will be asked to confirm again.",
          )}
          text={reviewed.text}
          onConfirm={() => props.controller.trust(props.entry, reviewed.token)}
        />
      ))
  }
  const active = () => props.entry.enabled && props.entry.trusted !== false
  return (
    <div
      class="settings-extension-row"
      data-component="buff-hook-row"
      data-hook={props.entry.id}
      data-trusted={props.entry.trusted}
    >
      <div class="settings-extension-lead">
        <div class="buff-kit-copy" classList={{ "opacity-60": !active() }}>
          <span class="settings-extension-name truncate">{props.entry.id}</span>
          <span class="buff-kit-note">{BuffHook.summary(props.entry, t)}</span>
          <span class="buff-kit-note font-mono line-clamp-2" title={props.entry.command}>
            {props.entry.command}
          </span>
          <Show when={props.entry.trusted === false}>
            <span class="buff-kit-note buff-kit-note--warn">{t(BuffHook.UNTRUSTED_NOTE)}</span>
          </Show>
          <Show when={props.entry.trusted === true}>
            <span class="buff-kit-note">{t("From the project; you confirmed it.")}</span>
          </Show>
          <Show when={!props.entry.enabled}>
            <span class="buff-kit-note">{t("Turned off: does not run.")}</span>
          </Show>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={props.entry.trusted === false}>
          <Button size="small" variant="neutral" data-action="buff-hook-review" onClick={() => void review()}>
            {t("Check")}
          </Button>
        </Show>
        <Show when={props.entry.trusted === true}>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-hook-distrust"
            onClick={() => void props.controller.distrust(props.entry)}
          >
            {t("Revoke trust")}
          </Button>
        </Show>
        <Button
          size="small"
          variant="ghost"
          data-action="buff-hook-edit"
          onClick={() =>
            void dialog.show(() => (
              <HookDialog controller={props.controller} scopes={props.scopes} entry={props.entry} />
            ))
          }
        >
          {t("Edit")}
        </Button>
        <Button
          size="small"
          variant="ghost"
          data-action="buff-hook-remove"
          onClick={() =>
            void dialog.show(() => (
              <ConfirmDialog
                title={t("Delete the hook «{id}»?", { id: props.entry.id })}
                text={t("The entry will be removed from {file}.", { file: props.entry.path })}
                confirm={t("Delete")}
                onConfirm={() => void props.controller.remove(props.entry)}
              />
            ))
          }
        >
          {t("Delete")}
        </Button>
        <Switch
          checked={props.entry.enabled}
          onChange={(enabled) => void props.controller.enable(props.entry, enabled)}
          hideLabel
        >
          {props.entry.id}
        </Switch>
      </div>
    </div>
  )
}

/** `scopes` — области, в которые здесь можно добавлять; первая предлагается по умолчанию. */
export function BuffHookSection(props: { directory: Accessor<string | undefined>; scopes: readonly BuffHook.Scope[] }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const controller = createController(props.directory)
  const groups = createMemo(() =>
    props.scopes.map((scope) => ({ scope, hooks: controller.entries().filter((entry) => entry.scope === scope) })),
  )

  return (
    <div class="flex flex-col gap-6" data-component="buff-hook-section">
      <div class="flex items-start justify-between gap-4">
        <span class="text-13-regular text-v2-text-text-muted">{t(BuffHook.ABOUT)}</span>
        <Button
          size="small"
          variant="neutral"
          icon="plus"
          class="shrink-0"
          data-action="buff-hook-add"
          onClick={() => void dialog.show(() => <HookDialog controller={controller} scopes={props.scopes} />)}
        >
          {t("Create hook")}
        </Button>
      </div>
      <Problem text={controller.problem()} />
      {/* #457: общий для всех проектов переключатель — на обеих вкладках хуков. */}
      <SettingsList>
        <BuffTrustPolicyRow />
      </SettingsList>
      <For each={groups()}>
        {(group) => (
          <div class="settings-section">
            <span class="settings-extension-heading text-13-medium">{t(GROUP_TITLE[group.scope])}</span>
            <Show
              when={group.hooks.length > 0}
              fallback={<span class="text-13-regular text-v2-text-text-muted">{t(GROUP_EMPTY[group.scope])}</span>}
            >
              <SettingsList variant="catalog">
                <For each={group.hooks}>
                  {(entry) => <HookRow entry={entry} controller={controller} scopes={props.scopes} />}
                </For>
              </SettingsList>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}
