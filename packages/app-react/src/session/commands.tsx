// The session screen's own commands (#584), registered while a session shows — the Solid
// useSessionCommands' session, project, MCP and permission commands: a new session, compact,
// export, copy the session's and the project's id, the MCPs dialog and auto-accept of permissions.
// The panes, the composer and the timeline register theirs from their own folders.

import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@opencode/app/react-reuse/session-export"
import { BuffFeatures } from "@opencode/schema/buff-features"
import { useCommandRegistration, useCommands } from "../commands/provider"
import { useDialog } from "../dialog/dialogs"
import { McpDialog } from "../providers/connect/mcp-dialog"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { showToast } from "../shell/notifications/toast"
import { useSettings, useSettingsModel } from "../shell/settings-context"
import { useSession } from "./context"

export function useSessionCommands() {
  const i18n = useI18n()
  const commands = useCommands()
  const session = useSession()
  const settings = useSettingsModel()
  const autoApprove = useSettings((value) => value.permissions.autoApprove)
  const info = useServerData(session.server, (state) => state.session.info[session.sessionID])
  const projectID = info?.projectID
  const directory = info?.location.directory
  const dialog = useDialog()
  const messages = useServerData(session.server, (state) => state.session.message[session.sessionID]?.length ?? 0)
  const sessionCategory = i18n.t("command.category.session")

  const copy = async (value: string, failed: { title: string; description: string }) => {
    try {
      await navigator.clipboard.writeText(value)
      showToast({ variant: "success", icon: true, title: i18n.t("common.copied"), description: value })
    } catch (cause) {
      showToast({
        variant: "error",
        title: failed.title,
        description: cause instanceof Error ? cause.message : failed.description,
      })
    }
  }

  const exportSession = async () => {
    try {
      const data = await fetchSessionExport({ sessionID: session.sessionID, api: session.server.api() })
      const filename = sessionExportFilename(data.info)
      if (!(await saveSessionExport(filename, data, {}))) return
      showToast({
        variant: "success",
        icon: true,
        title: i18n.t("toast.session.export.success.title"),
        description: i18n.t("toast.session.export.success.description", { filename }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: i18n.t("toast.session.export.failed.title"),
        description: cause instanceof Error ? cause.message : i18n.t("toast.session.export.failed.description"),
      })
    }
  }

  const toggleAutoAccept = () => {
    const active = !autoApprove
    settings.permissions({ autoApprove: active })
    showToast({
      title: i18n.t(active ? "toast.permissions.autoaccept.on.title" : "toast.permissions.autoaccept.off.title"),
      description: i18n.t(
        active ? "toast.permissions.autoaccept.on.description" : "toast.permissions.autoaccept.off.description",
      ),
    })
  }

  useCommandRegistration("session", () => [
    {
      id: "session.new",
      title: i18n.t("command.session.new"),
      category: sessionCategory,
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: (source) => commands.trigger("tab.new", source),
    },
    {
      id: "session.compact",
      title: i18n.t("command.session.compact"),
      description: i18n.t("command.session.compact.description"),
      category: sessionCategory,
      slash: "compact",
      disabled: messages === 0,
      onSelect: () => void session.server.api().session.compact({ sessionID: session.sessionID }),
    },
    ...(BuffFeatures.sessionTransfer
      ? [
          {
            id: "session.export",
            title: i18n.t("command.session.export"),
            description: i18n.t("command.session.export.description"),
            category: sessionCategory,
            slash: "export",
            onSelect: () => void exportSession(),
          },
        ]
      : []),
    {
      id: "session.copyID",
      title: i18n.t("command.session.copyID"),
      category: sessionCategory,
      onSelect: () =>
        void copy(session.sessionID, {
          title: i18n.t("toast.session.copyID.failed.title"),
          description: i18n.t("toast.session.copyID.failed.description"),
        }),
    },
    {
      id: "project.copyID",
      title: i18n.t("command.project.copyID"),
      category: i18n.t("command.category.project"),
      disabled: !projectID,
      onSelect: () =>
        projectID &&
        void copy(projectID, {
          title: i18n.t("toast.project.copyID.failed.title"),
          description: i18n.t("toast.project.copyID.failed.description"),
        }),
    },
    {
      id: "mcp.toggle",
      title: i18n.t("command.mcp.toggle"),
      description: i18n.t("command.mcp.toggle.description"),
      category: i18n.t("command.category.mcp"),
      keybind: "mod+;",
      slash: "mcp",
      disabled: !directory,
      onSelect: () =>
        directory &&
        dialog.show((close) => <McpDialog server={session.server} directory={directory} onClose={close} />),
    },
    {
      id: "permissions.autoaccept",
      title: i18n.t(autoApprove ? "command.permissions.autoaccept.disable" : "command.permissions.autoaccept.enable"),
      category: i18n.t("command.category.permissions"),
      keybind: "mod+shift+a",
      onSelect: toggleAutoAccept,
    },
  ])
}
