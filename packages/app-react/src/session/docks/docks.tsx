// The request docks above the composer (#584), ported from the Solid session composer region:
// an MCP server's request, the web-search choice, an agent's questions and a permission request.

import { useState } from "react"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { useSession } from "../context"
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
  return (
    <div data-component="session-request-docks" className="session-docks">
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
