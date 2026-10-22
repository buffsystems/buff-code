// A server's general settings (#584), ported from the Solid window's settings/servers/servers.tsx:
// its connection — state, address, the Default badge and «More options» (an SSH host and a WSL
// distro have their own rows) — and, once connected, its preferences: the terminal shell.

import { Badge } from "@buff/ui/react"
import type { ConfigEntry } from "@opencode/client/promise"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { serverName, type Server, type ServerConnection } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useServer } from "../../react/core"
import { AddServerMenu } from "../../servers/add-server"
import { openServerDialog } from "../../servers/dialogs"
import { useServerActions } from "../../servers/registry/actions"
import { LiveServerHealth, ServerRowMenu } from "../../servers/registry/row"
import { SshServerSettings } from "../../servers/ssh/settings"
import { WslServerSettings } from "../../servers/wsl/settings"
import { showToast } from "../../shell/notifications/toast"
import type { SettingsServer } from "../inventory"
import { SelectRow, SettingsBody, SettingsHeader, SettingsList, SettingsSection } from "../kit"
import { shellOptions, type ShellOption } from "./server-shell"

export function SettingsServerGeneral(props: {
  entry: SettingsServer
  nested?: boolean
  onAddServer?: () => void
  onServerChange?: (key: string) => void
}) {
  const i18n = useI18n()
  const actions = useServerActions()
  const dialog = useDialog()
  const entry = props.entry
  const edit = (server: ServerConnection) =>
    openServerDialog(dialog, { mode: "edit", server: actions.key(server), onSaved: props.onServerChange })
  const connection = entry.connection
  return (
    <>
      <SettingsHeader
        title={props.nested ? entry.name : i18n.t("settings.section.server")}
        description={i18n.t(props.nested ? "settings.server.description" : "settings.servers.description")}
        actions={!props.nested && props.onAddServer ? <AddServerMenu onAddServer={props.onAddServer} /> : undefined}
      />
      <SettingsBody sectioned>
        <section className="settings-section settings-server-connection" data-component="settings-server-connection">
          <h3 className="settings-section-title">{i18n.t("settings.server.section.connection")}</h3>
          <SettingsList>
            {entry.ssh && <SshServerSettings filter="" id={entry.ssh.config.id} actions={actions} />}
            {!entry.ssh && entry.wsl && <WslServerSettings actions={actions} servers={[entry.wsl]} />}
            {!entry.ssh && !entry.wsl && connection && (
              <div className="settings-servers-row">
                <div className="settings-servers-lead">
                  <LiveServerHealth conn={connection} />
                  <div className="settings-servers-copy">
                    <bdi className="settings-servers-name" dir="auto">
                      {serverName(connection) || entry.key}
                    </bdi>
                    <bdi className="settings-servers-meta" dir="ltr">
                      {connection.http.url}
                    </bdi>
                  </div>
                </div>
                <div className="settings-servers-actions">
                  {actions.defaults.available && actions.defaults.key === entry.key && (
                    <Badge>{i18n.t("dialog.server.status.default")}</Badge>
                  )}
                  <ServerRowMenu server={connection} actions={actions} onEdit={edit} />
                </div>
              </div>
            )}
          </SettingsList>
        </section>
        {connection && <ServerShell key={entry.key} conn={connection} />}
      </SettingsBody>
    </>
  )
}

// The shell the server's terminals and tools run, from its global config (#584).
function ServerShell(props: { conn: ServerConnection }) {
  const i18n = useI18n()
  const server = useServer(props.conn)
  const client = useQueryClient()
  const key = ["server-shell", server.key]
  const state = useQuery({ queryKey: key, queryFn: () => readShell(server) })
  const shells = state.data?.shells ?? []
  const current = state.data?.shell ?? ""
  const options = shellOptions({ shells, current })
  const select = (value: string) => {
    if (value === current || !state.data) return
    const previous = state.data
    client.setQueryData(key, { ...previous, shell: value || undefined })
    void server
      .api()
      .config.update({ shell: value || null })
      .catch((error: unknown) => {
        client.setQueryData(key, previous)
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
        })
      })
  }
  const label = (option: (typeof options)[number]) => {
    if (option.id === "auto") return i18n.t("settings.general.row.shell.autoDefault")
    if (!option.terminalOnly) return option.name
    return `${option.name} (${i18n.t("settings.general.row.shell.terminalOnly")})`
  }
  return (
    <SettingsSection title={i18n.t("settings.tab.preferences")}>
      <SettingsList>
        <SelectRow
          action="settings-shell"
          title={i18n.t("settings.general.row.shell.title")}
          description={i18n.t("settings.general.row.shell.description")}
          value={
            (
              options.find((option) => option.value === current) ??
              options.find((option) => option.id === current) ??
              options[0]
            )?.id ?? "auto"
          }
          options={options.map((option) => ({ value: option.id, label: label(option) }))}
          onChange={(id) => select(options.find((option) => option.id === id)?.value ?? "")}
        />
      </SettingsList>
    </SettingsSection>
  )
}

async function readShell(server: Server): Promise<{ shells: readonly ShellOption[]; shell?: string }> {
  const [entries, shells] = await Promise.all([
    server
      .api()
      .config.get()
      .catch((): ConfigEntry[] => []),
    server
      .api()
      .config.shells()
      .catch((): ShellOption[] => []),
  ])
  // Only the global documents count: the first directory entry starts the project's own config.
  const boundary = entries.findIndex((entry) => entry.type === "directory")
  const global = boundary === -1 ? entries : entries.slice(0, boundary)
  const shell = global
    .flatMap((entry) => (entry.type === "document" && entry.info.shell !== undefined ? [entry.info.shell] : []))
    .at(-1)
  return { shells, shell }
}
