// A session or draft of an SSH host that is not connected (#584), ported from the Solid window's
// ssh/connection-panel.tsx: what happened and «Reconnect» (or «Authenticate»).

import { Button, Callout, EmptyState } from "@buff/ui/react"
import { isSshConnecting, sshName, type SshItem } from "@opencode/app/ssh"
import { Lock } from "lucide-react"
import { useI18n } from "../../i18n/provider"

export function SshConnectionPanel(props: { item: SshItem; pending?: boolean; onReconnect: () => void }) {
  const i18n = useI18n()
  const connecting = props.pending || isSshConnecting(props.item.stage)
  const label = connecting
    ? "ssh.session.connecting"
    : props.item.stage === "authentication"
      ? "ssh.action.authenticate"
      : "ssh.session.reconnect"
  return (
    <section
      data-component="ssh-connection-panel"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center"
    >
      <EmptyState>
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <Lock aria-hidden className="size-5" />
          <h2 className="ui-title">{i18n.t("ssh.session.disconnected")}</h2>
          <bdi dir="auto" className="ui-note break-all">
            {sshName(props.item.config)}
          </bdi>
          <p className="ui-note">{i18n.t("ssh.session.reconnectDescription")}</p>
        </div>
      </EmptyState>
      {props.item.error && (
        <Callout tone="crit" role="alert">
          {i18n.t(`ssh.error.${props.item.error}`)}
        </Callout>
      )}
      <Button loading={connecting} aria-busy={connecting} onClick={props.onReconnect}>
        {i18n.t(label)}
      </Button>
    </section>
  )
}
