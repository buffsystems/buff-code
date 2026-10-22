// Memory in settings (#446), ported from the Solid window's buff/memory-settings.tsx: the AGENTS.md
// files — the person's shared one and the project's. When each changed, its text edited in place,
// a switch per file and one for all memory. Server settings show the person's memory, project
// settings the project's files too.

import "./settings.css"
import { Button, Field, Panel, Switch, Textarea } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffMemory } from "@opencode/schema/buff-memory"
import { useMemo, useState } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { FormDialog, Problem } from "./kit"
import { at, useBuffList } from "./rpc"

type Controller = ReturnType<typeof useMemoryController>

function useMemoryController(server: Server, directory: string | undefined) {
  const t = useI18n().buff.t
  const rpc = server.api().rpc(BuffMemory.Rpc)
  const empty: { enabled: boolean; files: readonly BuffMemory.File[] } = { enabled: true, files: [] }
  const list = useBuffList({
    server,
    name: "memory",
    directory,
    empty,
    load: () => rpc.list(undefined, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
    failure: t("Could not get the list."),
  })
  const failed = (error: unknown) =>
    showToast({ title: t("Memory"), description: formatServerError(error, undefined, t("Could not save.")) })
  return {
    problem: list.problem,
    enabled: list.value.enabled,
    files: list.value.files,
    read: (file: BuffMemory.File) => rpc.read({ path: file.path }, at(directory)),
    write: (file: BuffMemory.File, text: string) =>
      rpc.write({ path: file.path, text }, at(directory)).then(list.settle),
    enable: (enabled: boolean, file?: BuffMemory.File) =>
      rpc.enable({ ...(file ? { path: file.path } : {}), enabled }, at(directory)).then(list.settle, failed),
  }
}

function MemoryDialog(props: { controller: Controller; file: BuffMemory.File; text: string; onClose: () => void }) {
  const t = useI18n().buff.t
  const [text, setText] = useState(props.text)
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    await props.controller
      .write(props.file, text)
      .then(props.onClose, (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not save."))))
    setSaving(false)
  }
  return (
    <FormDialog
      title={BuffMemory.scopeTitle(props.file.scope, t)}
      name="buff-memory-form"
      action={t("Save")}
      actionTarget="buff-memory-save"
      busy={saving}
      onClose={props.onClose}
      onSubmit={() => void save()}
    >
      <Field
        label={props.file.path}
        hint={t("Plain text in Markdown. The model gets it at the start of the next session.")}
      >
        <Textarea
          rows={16}
          className="font-mono"
          value={text}
          placeholder={`${t("# Project rules")}\n\n- ${t("Run tests with make test")}\n- ${t("Write commits in English")}`}
          onChange={(event) => {
            setText(event.currentTarget.value)
            setProblem(undefined)
          }}
        />
      </Field>
      <Problem text={problem} />
    </FormDialog>
  )
}

function MemoryRow(props: { file: BuffMemory.File; controller: Controller; now: number }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const file = props.file
  const active = file.exists && file.enabled && props.controller.enabled
  const edit = async () => {
    const stored = await props.controller.read(file).catch((error: unknown) => {
      showToast({ title: t("Memory"), description: formatServerError(error, undefined, t("Could not open the file.")) })
      return undefined
    })
    if (!stored) return
    dialog.show((close) => (
      <MemoryDialog controller={props.controller} file={file} text={stored.text} onClose={close} />
    ))
  }
  return (
    <div className="buff-settings-row" data-component="buff-memory-row" data-scope={file.scope}>
      <div className="buff-settings-lead">
        <div className={active ? "buff-settings-copy" : "buff-settings-copy opacity-60"}>
          <span className="buff-settings-name truncate font-mono">{file.path}</span>
          <span className="buff-settings-note">{BuffMemory.note(file, props.controller.enabled, props.now, t)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" data-action="buff-memory-edit" onClick={() => void edit()}>
          {t(file.exists ? "Edit" : "Create")}
        </Button>
        {file.exists && (
          <Switch
            aria-label={file.path}
            checked={file.enabled}
            disabled={!props.controller.enabled}
            onCheckedChange={(enabled) => void props.controller.enable(enabled, file)}
          />
        )}
      </div>
    </div>
  )
}

/** `scopes` — whose memory is shown here. */
export function BuffMemorySection(props: { server: Server; directory?: string; scopes: readonly BuffMemory.Scope[] }) {
  const t = useI18n().buff.t
  const controller = useMemoryController(props.server, props.directory)
  // «5 min ago» counts from when the list was shown.
  const now = useMemo(() => Date.now(), [controller.files])
  const groups = props.scopes
    .map((scope) => ({ scope, files: controller.files.filter((file) => file.scope === scope) }))
    .filter((group) => group.files.length > 0)
  return (
    <div className="flex flex-col gap-6" data-component="buff-memory-section">
      <div className="flex items-start justify-between gap-4">
        <span className="ui-note">{t(BuffMemory.ABOUT)}</span>
        <label className="flex shrink-0 items-center gap-2 text-sm" data-action="buff-memory-all">
          <Switch checked={controller.enabled} onCheckedChange={(enabled) => void controller.enable(enabled)} />
          {t("Memory")}
        </label>
      </div>
      <Problem text={controller.problem} />
      {groups.map((group) => (
        <div key={group.scope} className="settings-section">
          <span className="settings-section-title">{BuffMemory.scopeTitle(group.scope, t)}</span>
          <Panel data-component="settings-list" data-variant="catalog">
            {group.files.map((file) => (
              <MemoryRow key={file.path} file={file} controller={controller} now={now} />
            ))}
          </Panel>
        </div>
      ))}
    </div>
  )
}
