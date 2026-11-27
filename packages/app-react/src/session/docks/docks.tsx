// The request docks above the composer (#584), ported from the Solid session composer region:
// an MCP server's request, the web-search choice, an agent's questions and a permission request.

import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { useSession } from "../context"
import { focusLost, nearestBox } from "../focus-box"
import { McpDock } from "./mcp-dock"
import { PermissionDock } from "./permission-dock"
import { QuestionDock } from "./question-dock"
import { useRequestSync, useSessionRequests } from "./requests"
import { WebSearchDock } from "./websearch-dock"
import "./docks.css"

export function SessionDocks() {
  const i18n = useI18n()
  const { server } = useSession()
  useRequestSync()
  const requests = useSessionRequests()
  const [responding, setResponding] = useState<string>()
  const permission = requests.permission
  const decide = (response: "once" | "always" | "reject", message?: string) => {
    if (!permission || responding === permission.id) return
    setResponding(permission.id)
    server
      .api()
      .permission.reply({
        sessionID: permission.sessionID,
        requestID: permission.id,
        decision: response,
        ...(message ? { message } : {}),
      })
      .catch((error: unknown) =>
        showToast({ title: i18n.t("common.requestFailed"), description: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => setResponding((id) => (id === permission.id ? undefined : id)))
  }
  // #972 (R23-02): an answered request leaves with the button that was pressed. Focus goes to
  // the next request's answer, or back to the message box — never to nowhere.
  const root = useRef<HTMLDivElement>(null)
  const shown = requests.question?.id ?? permission?.id
  const before = useRef(shown)
  useEffect(() => {
    const was = before.current
    before.current = shown
    if (!was || was === shown) return
    // Only when the person was answering here: focus that was elsewhere stays where it is. And
    // never onto a button that approves — the next request is read before it is answered.
    const answering = inside.current
    inside.current = false
    if (!answering) return
    const frame = requestAnimationFrame(() => {
      if (!focusLost()) return
      const next = shown ? root.current : null
      ;(next ?? nearestBox(root.current))?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [shown])
  // Whether focus is in the docks: set as it comes in, cleared when it goes elsewhere by itself
  // (a dock that leaves takes focus with it and tells nobody — that is the case this serves).
  const inside = useRef(false)
  return (
    <div
      ref={root}
      data-component="session-request-docks"
      className="session-docks"
      tabIndex={-1}
      onFocus={() => (inside.current = true)}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) inside.current = false
      }}
    >
      <McpDock />
      {requests.websearch && <WebSearchDock key={requests.websearch.id} request={requests.websearch} onSubmit={() => undefined} />}
      {requests.question && <QuestionDock key={requests.question.id} request={requests.question} onSubmit={() => undefined} />}
      {permission && (
        <PermissionDock
          key={permission.id}
          request={permission}
          responding={responding === permission.id}
          subagent={requests.permissionFromSubagent}
          onDecide={decide}
        />
      )}
    </div>
  )
}
