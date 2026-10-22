// WSL distros in the server settings (#584), ported from the Solid window's WslServerSettings: the
// distro's state and OpenCode version, «Install/Update OpenCode», and «More options» — retry a
// failed or stopped start, the default server, remove.

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@buff/ui/react"
import { wslOpencodeAction, wslRuntimeRetryable } from "@opencode/app/react-reuse/wsl-model"
import type { WslServerItem } from "@opencode/app/wsl/types"
import { Ellipsis } from "lucide-react"
import { useState } from "react"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { showToast } from "../../shell/notifications/toast"
import type { ServerActions } from "../registry/actions"
import { ServerHealthIndicator } from "../registry/row"
import { useWslState } from "../remote-state"

export function WslServerSettings(props: { actions: ServerActions; servers: readonly WslServerItem[] }) {
  const api = usePlatform().wslServers
  if (!api) return null
  return (
    <>
      {props.servers.map((item) => (
        <WslRow key={item.config.id} item={item} actions={props.actions} />
      ))}
    </>
  )
}

function health(item: WslServerItem) {
  if (item.runtime.kind === "ready") return { healthy: true }
  if (item.runtime.kind === "failed") return { healthy: false }
  return undefined
}

function WslRow(props: { item: WslServerItem; actions: ServerActions }) {
  const i18n = useI18n()
  const api = usePlatform().wslServers
  const state = useWslState()
  const [pending, setPending] = useState(false)
  const item = props.item
  const key = item.config.id
  const check = state?.opencodeChecks[item.config.distro]
  const action = wslOpencodeAction(check)
  const updating = state?.job?.kind === "install-opencode" && state.job.distro === item.config.distro
  const defaults = props.actions.defaults
  const run = (task: () => Promise<unknown>) => {
    setPending(true)
    void task()
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setPending(false))
  }
  return (
    <div className="settings-servers-row">
      <div className="settings-servers-lead">
        <ServerHealthIndicator health={health(item)} connecting={item.runtime.kind === "starting"} />
        <div className="settings-servers-copy">
          <span className="flex min-w-0 items-center gap-1">
            <span className="settings-servers-name">{item.config.distro}</span>
            <Badge>{i18n.t("wsl.server.label")}</Badge>
          </span>
          <span className="settings-servers-meta">{check?.version ? `v${check.version}` : ""}</span>
        </div>
      </div>
      <div className="settings-servers-actions">
        {defaults.available && defaults.key === key && <Badge>{i18n.t("dialog.server.status.default")}</Badge>}
        {action && (
          <Button
            size="sm"
            disabled={updating || pending}
            onClick={() => api && run(() => api.installOpencode(item.config.distro))}
          >
            {updating ? i18n.t("wsl.server.updating") : i18n.t(action)}
          </Button>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton icon={Ellipsis} size="xs" aria-label={i18n.t("common.moreOptions")} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{i18n.t("wsl.server.menu.label")}</DropdownMenuLabel>
              {wslRuntimeRetryable(item.runtime) && (
                <DropdownMenuItem onSelect={() => api && run(() => api.startServer(key))}>
                  {i18n.t("wsl.server.retryStart")}
                </DropdownMenuItem>
              )}
              {defaults.available && defaults.key !== key && (
                <DropdownMenuItem onSelect={() => void defaults.set(key)}>
                  {i18n.t("dialog.server.menu.default")}
                </DropdownMenuItem>
              )}
              {defaults.available && defaults.key === key && (
                <DropdownMenuItem onSelect={() => void defaults.set(null)}>
                  {i18n.t("dialog.server.menu.defaultRemove")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive disabled={pending} onSelect={() => run(() => props.actions.remove(key))}>
                {i18n.t("dialog.server.menu.remove")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
