import { createMemo, createSignal, For, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import "@/buff/permission-mode.css"
import type { PermissionRequest } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useBuffText } from "@/buff/i18n"
import { permissionDiffs } from "@/buff/permission-preview"
import { useFileComponent } from "@opencode/ui/context/file"
import { resolveFileDiff } from "@opencode/session-ui/session-diff"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject", message?: string) => void
  // Buff (#450): запрос пришёл от субагента.
  subagent?: boolean
}) {
  const language = useLanguage()
  const buffText = useBuffText()
  // Buff (#450): отказ с пояснением уходит модели, и ход продолжается.
  const [feedback, setFeedback] = createSignal("")
  const alwaysNote = () => BuffPermissionMode.alwaysNote(props.request, buffText.t)
  // Buff (#470): правка видна в самом запросе — дифф, который положил инструмент.
  const fileComponent = useFileComponent()
  const diffs = createMemo(() =>
    permissionDiffs(props.request.metadata).flatMap((diff) => {
      try {
        const fileDiff = resolveFileDiff(diff)
        return fileDiff ? [{ file: diff.file, fileDiff }] : []
      } catch {
        return []
      }
    }),
  )

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.action}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    // Buff (#447): своё действие — своё пояснение (файлы переводов апстрима не трогаем).
    if (props.request.action === BuffAutomation.PERMISSION_ACTION) return buffText.t(BuffAutomation.PERMISSION_HINT)
    if (props.request.action === BuffWorkflow.PERMISSION_ACTION)
      return BuffWorkflow.permissionView(props.request.metadata, buffText.t).hint
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">
            {language.t("notification.permission.title")}
            {/* Внутри заголовка: шапка — сетка «значок · заголовок», третий элемент падал под значок. */}
            <Show when={props.subagent}>
              <span class="buff-permission-badge" data-slot="buff-permission-subagent">
                {buffText.t(BuffPermissionMode.SUBAGENT)}
              </span>
            </Show>
          </div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button
              variant="ghost"
              size="normal"
              onClick={() => props.onDecide("reject", feedback().trim() || undefined)}
              disabled={props.responding}
            >
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="neutral"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding || !alwaysNote()}
              title={alwaysNote()}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="submit" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.resources.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.resources}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>

      <For each={diffs()}>
        {(diff) => (
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div class="buff-permission-diff" data-component="buff-permission-diff" data-file={diff.file}>
              <Dynamic
                component={fileComponent}
                mode="diff"
                fileDiff={diff.fileDiff}
                hunkSeparators="line-info-basic"
              />
            </div>
          </div>
        )}
      </For>

      <Show when={alwaysNote()}>
        {(note) => (
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-hint" data-buff="always-note">
              {note()}
            </div>
          </div>
        )}
      </Show>
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <input
          class="buff-permission-feedback"
          data-action="buff-permission-feedback"
          placeholder={buffText.t(BuffPermissionMode.REJECT_PLACEHOLDER)}
          value={feedback()}
          disabled={props.responding}
          onInput={(event) => setFeedback(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && feedback().trim()) props.onDecide("reject", feedback().trim())
          }}
        />
      </div>
    </DockPrompt>
  )
}
