// A permission request above the composer (#584), ported from the Solid permission dock: what
// the tool wants to do, Buff's "allow always" scope and the diff of an edit, and a reason for
// denying that goes to the model while the turn continues.

import { Badge, Button, Input } from "@buff/ui/react"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { permissionDiffs } from "@opencode/app/react-reuse/permission-preview"
import type { PermissionRequest } from "@opencode/client/promise"
import { TriangleAlert } from "lucide-react"
import { useState } from "react"
import { useI18n } from "../../i18n/provider"
import { DockPrompt } from "./dock"

export function PermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  subagent: boolean
  onDecide(response: "once" | "always" | "reject", message?: string): void
}) {
  const i18n = useI18n()
  const [feedback, setFeedback] = useState("")
  const request = props.request
  const alwaysNote = BuffPermissionMode.alwaysNote(request, i18n.buff.t)
  const diffs = permissionDiffs(request.metadata)
  const description = () => {
    if (request.action === BuffAutomation.PERMISSION_ACTION) return i18n.buff.t(BuffAutomation.PERMISSION_HINT)
    if (request.action === BuffWorkflow.PERMISSION_ACTION) return BuffWorkflow.permissionView(request.metadata, i18n.buff.t).hint
    const key = `settings.permissions.tool.${request.action}.description`
    const value = i18n.t(key as Parameters<typeof i18n.t>[0])
    return value === key ? "" : value
  }
  const hint = description()
  const reject = () => props.onDecide("reject", feedback.trim() || undefined)
  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header" className="dock-prompt__row">
          <TriangleAlert aria-hidden data-slot="permission-icon" className="dock-prompt__icon dock-prompt__icon--warning" />
          <div data-slot="permission-header-title" className="dock-prompt__title">
            {i18n.t("notification.permission.title")}
            {props.subagent && (
              <Badge data-slot="buff-permission-subagent">{i18n.buff.t(BuffPermissionMode.SUBAGENT)}</Badge>
            )}
          </div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions" className="dock-prompt__actions">
            <Button variant="ghost" onClick={reject} disabled={props.responding}>
              {i18n.t("ui.permission.deny")}
            </Button>
            <Button variant="outline" onClick={() => props.onDecide("always")} disabled={props.responding || !alwaysNote} title={alwaysNote}>
              {i18n.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {i18n.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      {hint && <div data-slot="permission-hint" className="dock-prompt__hint">{hint}</div>}
      {request.resources.length > 0 && (
        <div data-slot="permission-patterns" className="dock-prompt__patterns">
          {request.resources.map((pattern) => (
            <code key={pattern}>{pattern}</code>
          ))}
        </div>
      )}
      {diffs.map((diff) => (
        <pre key={diff.file} className="ui-code-block dock-prompt__diff" data-component="buff-permission-diff" data-file={diff.file}>
          {diff.file}
        </pre>
      ))}
      {alwaysNote && (
        <div data-slot="permission-hint" data-buff="always-note" className="dock-prompt__hint">
          {alwaysNote}
        </div>
      )}
      <Input
        data-action="buff-permission-feedback"
        placeholder={i18n.buff.t(BuffPermissionMode.REJECT_PLACEHOLDER)}
        value={feedback}
        disabled={props.responding}
        onChange={(event) => setFeedback(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && feedback.trim()) props.onDecide("reject", feedback.trim())
        }}
      />
    </DockPrompt>
  )
}
