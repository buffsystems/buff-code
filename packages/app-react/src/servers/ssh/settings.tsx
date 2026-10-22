// Saved SSH hosts in the server settings (#584), ported from the Solid window's ssh/settings.tsx:
// the host's state, «Authenticate» while it asks, the Default badge and its menu.

import { Badge, Button } from "@buff/ui/react"
import { isSshConnecting, sshName, type SshItem } from "@opencode/app/ssh"
import { useI18n } from "../../i18n/provider"
import type { ServerActions } from "../registry/actions"
import { ServerHealthIndicator } from "../registry/row"
import { useSshState } from "./context"
import { SshMenu } from "./menu"

export function SshServerSettings(props: { filter: string; id?: string; actions: ServerActions }) {
  const { items } = useSshState()
  const filter = props.filter.toLowerCase()
  const shown = items.filter(
    (item) =>
      item.saved &&
      (!props.id || item.config.id === props.id) &&
      `${item.config.name} ${item.config.target}`.toLowerCase().includes(filter),
  )
  return (
    <>
      {shown.map((item) => (
        <SshRow key={item.config.id} item={item} actions={props.actions} />
      ))}
    </>
  )
}

function health(item: SshItem) {
  if (item.stage === "ready") return { healthy: true }
  if (item.stage === "incompatible") return { healthy: false, incompatible: true }
  if (item.stage === "failed") return { healthy: false }
  return undefined
}

function SshRow(props: { item: SshItem; actions: ServerActions }) {
  const i18n = useI18n()
  const { ssh } = useSshState()
  const item = props.item
  const id = item.config.id
  const pending = ssh.pending(id)
  return (
    <div className="settings-servers-row">
      <div className="settings-servers-lead">
        <ServerHealthIndicator
          health={health(item)}
          connecting={isSshConnecting(item.stage)}
          authenticationRequired={item.stage === "authentication"}
        />
        <div className="settings-servers-copy">
          <span className="flex min-w-0 items-center gap-1">
            <bdi className="settings-servers-name truncate" dir={item.config.name ? "auto" : "ltr"}>
              {sshName(item.config)}
            </bdi>
            <Badge>{i18n.t("ssh.label")}</Badge>
          </span>
          {item.stage === "authentication" && (
            <span className="settings-servers-meta">{i18n.t("ssh.stage.authentication")}</span>
          )}
        </div>
      </div>
      <div className="settings-servers-actions">
        {(item.stage === "authentication" || pending) && (
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            aria-busy={pending}
            onClick={() => ssh.connect(item.config)}
          >
            {i18n.t(pending ? "ssh.session.connecting" : "ssh.action.authenticate")}
          </Button>
        )}
        {props.actions.defaults.available && props.actions.defaults.key === `ssh:${id}` && (
          <Badge>{i18n.t("dialog.server.status.default")}</Badge>
        )}
        <SshMenu id={id} actions={props.actions} />
      </div>
    </div>
  )
}
