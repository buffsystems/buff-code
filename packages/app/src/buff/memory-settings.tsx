import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { BuffMemory } from "@opencode/schema/buff-memory"
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
import { FormBody, Hint, Problem } from "./settings-kit"

/**
 * Память в настройках (#446): файлы AGENTS.md — общий у пользователя и файлы проекта. Видно,
 * когда каждый изменён; текст правится на месте; выключатель есть у файла и общий. Настройки
 * сервера показывают память пользователя, настройки проекта — ещё и файлы проекта.
 */

type Controller = ReturnType<typeof createController>

function createController(directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffMemory.Rpc)
  const at = () => {
    const value = directory()
    return value ? { location: { directory: value } } : undefined
  }
  const empty = { enabled: true, files: [] as BuffMemory.File[] }
  // Сбой загрузки — не «пусто»: причина показывается над списком.
  const [problem, setProblem] = createSignal<string>()
  const [state, { refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? (directory() ?? "") : undefined),
    () =>
      rpc.list(undefined, at()).then(
        (result) => {
          setProblem(undefined)
          return result
        },
        (error: unknown) => {
          setProblem(formatServerError(error, undefined, t("Could not get the list.")))
          return empty
        },
      ),
    { initialValue: empty },
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
    showToast({ title: t("Memory"), description: formatServerError(error, undefined, t("Could not save.")) })

  return {
    problem,
    enabled: () => state.latest?.enabled ?? true,
    files: () => state.latest?.files ?? [],
    read: (file: BuffMemory.File) => rpc.read({ path: file.path }, at()),
    write: (file: BuffMemory.File, text: string) => rpc.write({ path: file.path, text }, at()).then(settle),
    enable: (enabled: boolean, file?: BuffMemory.File) =>
      rpc.enable({ ...(file ? { path: file.path } : {}), enabled }, at()).then(settle, failed),
  }
}

function MemoryDialog(props: { controller: Controller; file: BuffMemory.File; text: string }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const [text, setText] = createSignal(props.text)
  const [problem, setProblem] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const save = async () => {
    setSaving(true)
    await props.controller.write(props.file, text()).then(
      () => dialog.close(),
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))),
    )
    setSaving(false)
  }
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{BuffMemory.scopeTitle(props.file.scope, t)}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-memory-form">
          <TextField
            multiline
            label={props.file.path}
            class="buff-kit-area buff-kit-area--page font-mono"
            placeholder={`${t("# Project rules")}\n\n- ${t("Run tests with make test")}\n- ${t("Write commits in English")}`}
            value={text()}
            onChange={(value) => {
              setText(value)
              setProblem(undefined)
            }}
          />
          <Hint>{t("Plain text in Markdown. The model gets it at the start of the next session.")}</Hint>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-memory-save" disabled={saving()} onClick={() => void save()}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function MemoryRow(props: { file: BuffMemory.File; controller: Controller; now: number }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const edit = async () => {
    const stored = await props.controller.read(props.file).catch((error: unknown) => {
      showToast({ title: t("Memory"), description: formatServerError(error, undefined, t("Could not open the file.")) })
      return undefined
    })
    if (stored)
      void dialog.show(() => <MemoryDialog controller={props.controller} file={props.file} text={stored.text} />)
  }
  const active = () => props.file.exists && props.file.enabled && props.controller.enabled()
  return (
    <div class="settings-extension-row" data-component="buff-memory-row" data-scope={props.file.scope}>
      <div class="settings-extension-lead">
        <div class="buff-kit-copy" classList={{ "opacity-60": !active() }}>
          <span class="settings-extension-name truncate font-mono">{props.file.path}</span>
          <span class="buff-kit-note">{BuffMemory.note(props.file, props.controller.enabled(), props.now, t)}</span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button size="small" variant="ghost" data-action="buff-memory-edit" onClick={() => void edit()}>
          {t(props.file.exists ? "Edit" : "Create")}
        </Button>
        <Show when={props.file.exists}>
          <Switch
            checked={props.file.enabled}
            disabled={!props.controller.enabled()}
            onChange={(enabled) => void props.controller.enable(enabled, props.file)}
            hideLabel
          >
            {props.file.path}
          </Switch>
        </Show>
      </div>
    </div>
  )
}

/** `scopes` — чью память здесь показывать. */
export function BuffMemorySection(props: {
  directory: Accessor<string | undefined>
  scopes: readonly BuffMemory.Scope[]
}) {
  const controller = createController(props.directory)
  const { t } = useBuffText()
  const groups = createMemo(() =>
    props.scopes
      .map((scope) => ({ scope, files: controller.files().filter((file) => file.scope === scope) }))
      .filter((group) => group.files.length > 0),
  )
  // «5 мин назад» считается от момента показа списка.
  const now = createMemo(() => (controller.files(), Date.now()))

  return (
    <div class="flex flex-col gap-6" data-component="buff-memory-section">
      <div class="flex items-start justify-between gap-4">
        <span class="text-13-regular text-v2-text-text-muted">{t(BuffMemory.ABOUT)}</span>
        <Switch
          checked={controller.enabled()}
          data-action="buff-memory-all"
          onChange={(enabled) => void controller.enable(enabled)}
        >
          {t("Memory")}
        </Switch>
      </div>
      <Problem text={controller.problem()} />
      <For each={groups()}>
        {(group) => (
          <div class="settings-section">
            <span class="settings-extension-heading text-13-medium">{BuffMemory.scopeTitle(group.scope, t)}</span>
            <SettingsList variant="catalog">
              <For each={group.files}>{(file) => <MemoryRow file={file} controller={controller} now={now()} />}</For>
            </SettingsList>
          </div>
        )}
      </For>
    </div>
  )
}
