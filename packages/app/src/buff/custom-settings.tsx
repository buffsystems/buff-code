import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffCustom } from "@opencode/schema/buff-custom"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { useModels } from "@/providers/models/models"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"
import { originGroups } from "./origin-groups"
import { Choice, ConfirmDialog, FormBody, Hint, Problem, ReviewDialog } from "./settings-kit"

/**
 * Команды и субагенты в настройках (#446): создать, поправить, удалить, включить и выключить —
 * без правки файлов руками. Экран один на оба вида: чем они различаются (поля формы, слова),
 * сказано в описании вида (`BuffCustom.kinds`). Настройки сервера показывают записи
 * пользователя, настройки проекта — ещё и записи проекта. Чужие записи (встроенные, из файла
 * настроек) видны и выключаются, но не правятся.
 */

const SCOPE_OPTIONS = [
  { value: "project", label: "In the project" },
  { value: "user", label: "On my machine — for all projects" },
] as const
const READ_ONLY: readonly BuffCustom.Origin[] = ["config", "builtin"]

type Controller = ReturnType<typeof createController>
type Content = { values: Record<string, string>; body: string }

function createController(kind: BuffCustom.Kind, directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffCustom.Rpc)
  const at = () => {
    const value = directory()
    return value ? { location: { directory: value } } : undefined
  }
  // Сбой загрузки — не «пусто»: причина показывается над списком.
  const [problem, setProblem] = createSignal<string>()
  const [entries, { refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? (directory() ?? "") : undefined),
    () =>
      rpc.list({ kind: kind.name }, at()).then(
        (list) => {
          setProblem(undefined)
          return list
        },
        (error: unknown) => {
          setProblem(formatServerError(error, undefined, t("Could not get the list.")))
          return [] as BuffCustom.Entry[]
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
    showToast({
      title: t(kind.words.title),
      description: formatServerError(error, undefined, t("Could not save.")),
    })
  const target = (entry: BuffCustom.Entry) => ({
    kind: kind.name,
    scope: entry.scope as BuffCustom.Scope,
    id: entry.id,
  })

  return {
    kind,
    problem,
    entries: () => entries.latest ?? [],
    read: (entry: BuffCustom.Entry) => rpc.read(target(entry), at()),
    save: (scope: BuffCustom.Scope, id: string, content: Content, previous?: { scope: BuffCustom.Scope; id: string }) =>
      rpc.save({ kind: kind.name, scope, id, ...content, ...(previous ? { previous } : {}) }, at()).then(settle),
    remove: (entry: BuffCustom.Entry) => rpc.remove(target(entry), at()).then(settle, failed),
    review: (entry: BuffCustom.Entry) => rpc.review({ kind: kind.name, id: entry.id }, at()),
    /** Подтвердить просмотренное; строка — почему не вышло. */
    trust: (entry: BuffCustom.Entry, token: string) =>
      rpc.trust({ kind: kind.name, id: entry.id, token }, at()).then(
        () => (settle(), undefined),
        (error: unknown) => formatServerError(error, undefined, t("Could not confirm.")),
      ),
    distrust: (entry: BuffCustom.Entry) => rpc.trust({ kind: kind.name, id: entry.id }, at()).then(settle, failed),
    enable: (entry: BuffCustom.Entry, enabled: boolean) =>
      rpc.enable({ kind: kind.name, id: entry.id, enabled }, at()).then(settle, failed),
  }
}

/** Пункт «модель сессии»: выбор не принимает пустое значение, а в файл пишется пустое. */
const SESSION_MODEL = "session"

/** Поле «Модель»: выбор из доступных моделей; записанная руками, но недоступная — остаётся в списке. */
function ModelField(props: { field: BuffCustom.Field; value: string; onChange: (value: string) => void }) {
  const models = useModels()
  const { t } = useBuffText()
  const options = createMemo(() => {
    const known = models.list().map((model) => ({ value: `${model.provider.id}/${model.id}`, label: model.name }))
    const missing = props.value && !known.some((option) => option.value === props.value)
    return [
      { value: SESSION_MODEL, label: t("Session model") },
      ...(missing ? [{ value: props.value, label: props.value }] : []),
      ...known.toSorted((a, b) => a.label.localeCompare(b.label)),
    ]
  })
  return (
    <div class="flex items-center justify-between gap-3">
      <span class="text-12-regular text-text-weak">{t(props.field.label)}</span>
      <Select
        data-action={`buff-custom-${props.field.key}`}
        options={options()}
        current={options().find((option) => option.value === (props.value || SESSION_MODEL))}
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && props.onChange(option.value === SESSION_MODEL ? "" : option.value)}
      />
    </div>
  )
}

function FieldInput(props: { field: BuffCustom.Field; value: string; onChange: (value: string) => void }) {
  const { t } = useBuffText()
  const options = createMemo(() => props.field.options?.map((option) => ({ ...option, label: t(option.label) })))
  return (
    <Show
      when={!props.field.model}
      fallback={<ModelField field={props.field} value={props.value} onChange={props.onChange} />}
    >
      <Show
        when={options()}
        fallback={
          <TextField
            label={t(props.field.label)}
            placeholder={props.field.placeholder && t(props.field.placeholder)}
            value={props.value}
            onChange={props.onChange}
          />
        }
      >
        {(options) => (
          <div class="flex flex-col gap-1.5">
            <span class="text-12-regular text-text-weak">{t(props.field.label)}</span>
            <Choice value={props.value || options()[0].value} options={options()} onPick={props.onChange} />
          </div>
        )}
      </Show>
      <Show when={props.field.hint}>{(hint) => <Hint>{t(hint())}</Hint>}</Show>
    </Show>
  )
}

function EntryDialog(props: {
  controller: Controller
  scopes: readonly BuffCustom.Scope[]
  entry?: BuffCustom.Entry
  content?: Content
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const kind = props.controller.kind
  const stored = props.entry
  const [form, setForm] = createStore({
    id: stored?.id ?? "",
    values: BuffCustom.formValues(kind, props.content?.values),
    body: props.content?.body ?? "",
    scope: (stored?.scope as BuffCustom.Scope | undefined) ?? props.scopes[0],
  })
  const [problem, setProblem] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const edited = () => setProblem(undefined)

  const save = async () => {
    const draft = { id: form.id.trim(), values: { ...form.values }, body: form.body }
    const invalid = BuffCustom.problem(kind, draft, t)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    const previous = stored ? { scope: stored.scope as BuffCustom.Scope, id: stored.id } : undefined
    await props.controller.save(form.scope, draft.id, draft, previous).then(
      () => dialog.close(),
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))),
    )
    setSaving(false)
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{stored ? kind.words.edit(stored.id, t) : t(kind.words.created)}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-custom-form">
          <TextField
            label={t("Short name")}
            placeholder={kind.idPlaceholder}
            value={form.id}
            onChange={(value) => {
              setForm("id", value)
              edited()
            }}
          />
          <Hint>{t(kind.idHint)}</Hint>
          <For each={kind.fields}>
            {(field) => (
              <FieldInput
                field={field}
                value={form.values[field.key] ?? ""}
                onChange={(value) => {
                  setForm("values", field.key, value)
                  edited()
                }}
              />
            )}
          </For>
          <TextField
            multiline
            label={t(kind.body.label)}
            class="buff-kit-area buff-kit-area--tall font-mono"
            placeholder={t(kind.body.placeholder)}
            value={form.body}
            onChange={(value) => {
              setForm("body", value)
              edited()
            }}
          />
          <Hint>{t(kind.body.hint)}</Hint>
          <Show when={props.scopes.length > 1}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-weak">{t("Where to keep")}</span>
              <Choice
                value={form.scope}
                options={SCOPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                onPick={(value) => setForm("scope", value)}
              />
              <span class="text-12-regular text-text-weak">{t(kind.words.scopeNote[form.scope])}</span>
            </div>
          </Show>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-custom-save" disabled={saving()} onClick={() => void save()}>
          {t(stored ? "Save" : "Create")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Что сказать о записи под описанием: значения полей-выборов и модель. */
function meta(kind: BuffCustom.Kind, entry: BuffCustom.Entry, t: BuffI18n.T): string {
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
  const dialog = useDialog()
  const { t } = useBuffText()
  const kind = props.controller.kind
  const own = () => props.entry.scope === "user" || props.entry.scope === "project"
  const edit = async () => {
    const content = await props.controller.read(props.entry).catch((error: unknown) => {
      showToast({
        title: t(kind.words.title),
        description: formatServerError(error, undefined, t("Could not open.")),
      })
      return undefined
    })
    if (content)
      void dialog.show(() => (
        <EntryDialog controller={props.controller} scopes={props.scopes} entry={props.entry} content={content} />
      ))
  }
  const review = async () => {
    const reviewed = await props.controller.review(props.entry).catch((error: unknown) => {
      showToast({ title: t(kind.words.title), description: formatServerError(error, undefined, t("Could not open.")) })
      return undefined
    })
    if (reviewed)
      void dialog.show(() => (
        <ReviewDialog
          title={t("Trust {name}?", { name: BuffCustom.mention(kind, props.entry.id) })}
          intro={t(
            "This entry came from the project. Check its text: inserts like !`command` run on your machine. If the text changes, you will be asked to confirm again.",
          )}
          text={reviewed.text}
          onConfirm={() => props.controller.trust(props.entry, reviewed.token)}
        />
      ))
  }
  return (
    <div
      class="settings-extension-row"
      data-component="buff-custom-row"
      data-entry={props.entry.id}
      data-trusted={props.entry.trusted}
    >
      <div class="settings-extension-lead">
        <div class="buff-kit-copy" classList={{ "opacity-60": !props.entry.enabled }}>
          <span class="settings-extension-name truncate font-mono">{BuffCustom.mention(kind, props.entry.id)}</span>
          {/* #470: описания встроенных команд и агентов приходят из ядра по-английски — переводятся каталогом. */}
          <Show when={props.entry.description}>
            {(description) => (
              <span class="buff-kit-note line-clamp-2" title={t(description())}>
                {t(description())}
              </span>
            )}
          </Show>
          <Show when={meta(kind, props.entry, t)}>{(text) => <span class="buff-kit-note">{text()}</span>}</Show>
          <Show when={props.entry.scope === "config"}>
            <span class="buff-kit-note">{t(kind.words.readOnly)}</span>
          </Show>
          <Show when={!props.entry.enabled}>
            <span class="buff-kit-note">{t(kind.words.disabled)}</span>
          </Show>
          <Show when={props.entry.trusted === false}>
            <span class="buff-kit-note buff-kit-note--warn">{t(BuffCustom.UNTRUSTED_NOTE)}</span>
          </Show>
          <Show when={props.entry.trusted === true}>
            <span class="buff-kit-note">{t("From the project; you confirmed the text.")}</span>
          </Show>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={props.entry.trusted === false}>
          <Button size="small" variant="neutral" data-action="buff-custom-review" onClick={() => void review()}>
            {t("Check")}
          </Button>
        </Show>
        <Show when={props.entry.trusted === true}>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-custom-distrust"
            onClick={() => void props.controller.distrust(props.entry)}
          >
            {t("Revoke trust")}
          </Button>
        </Show>
        <Show when={own()}>
          <Button size="small" variant="ghost" data-action="buff-custom-edit" onClick={() => void edit()}>
            {t("Edit")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-custom-remove"
            onClick={() =>
              void dialog.show(() => (
                <ConfirmDialog
                  title={kind.words.remove(props.entry.id, t)}
                  text={t("The file {file} will be deleted.", { file: props.entry.path ?? "" })}
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
          {props.entry.id}
        </Switch>
      </div>
    </div>
  )
}

/** `scopes` — области, в которые здесь можно добавлять; первая предлагается по умолчанию. */
export function BuffCustomSection(props: {
  kind: BuffCustom.KindName
  directory: Accessor<string | undefined>
  scopes: readonly BuffCustom.Scope[]
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const kind = BuffCustom.kinds[props.kind]
  const controller = createController(kind, props.directory)
  const [query, setQuery] = createSignal("")
  const groups = createMemo(() =>
    originGroups(controller.entries(), query(), [...props.scopes, ...READ_ONLY], props.scopes, (entry) => [
      entry.id,
      entry.description ?? "",
    ]),
  )

  return (
    <div class="flex flex-col gap-6" data-component="buff-custom-section" data-kind={kind.name}>
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <TextField
            hideLabel
            label={t(kind.words.search)}
            placeholder={t(kind.words.search)}
            value={query()}
            onChange={setQuery}
          />
        </div>
        <Button
          size="small"
          variant="neutral"
          icon="plus"
          data-action="buff-custom-add"
          onClick={() => void dialog.show(() => <EntryDialog controller={controller} scopes={props.scopes} />)}
        >
          {t(kind.words.create)}
        </Button>
      </div>
      <Problem text={controller.problem()} />
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
              <span class="settings-extension-heading text-13-medium">{t(kind.words.groups[group.scope])}</span>
              <Show
                when={group.items.length > 0}
                fallback={
                  <span class="text-13-regular text-v2-text-text-muted">
                    {t(kind.words.empty[group.scope as BuffCustom.Scope])}
                  </span>
                }
              >
                <SettingsList variant="catalog">
                  <For each={group.items}>
                    {(entry) => <EntryRow entry={entry} controller={controller} scopes={props.scopes} />}
                  </For>
                </SettingsList>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
