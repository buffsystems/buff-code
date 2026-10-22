// The shell's actions and their commands (#584): Home toggles with the last tab, a new tab opens
// a draft in the shown project, tabs close and reopen, the window goes back and forward.

import { serverKey } from "../core/servers"
import { useCommandRegistration } from "../commands/provider"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useCore, useServers } from "../react/core"
import { useNavigate, useRoute } from "../router/router"
import { isMac } from "../commands/keybind"
import { adjacentHomeProject, openHomeProjects, useHomeSelection } from "../home/selection"
import { useDirectoryPicker } from "./directory-picker/picker"
import { useWindowHistory } from "./navigation"
import { useUpdaterCheck } from "./updates/update-button"
import { PAGE_ENTRIES } from "./page-entries"
import { useCurrentTab, useTabs } from "./tabs/provider"
import { tabKey, tabServer } from "./tabs/tabs"

export function useShellActions() {
  const tabs = useTabs()
  const core = useCore()
  const servers = useServers()
  const route = useRoute()
  const current = useCurrentTab()
  const home = route.name === "home"

  const toggleHome = () => tabs.toggleHome(home, current)

  /** A draft in the project on screen: the shown session's or draft's, else the last used. */
  const openNewTab = () => {
    if (route.name === "session") {
      const conn = servers.find((item) => serverKey(item) === route.serverKey)
      const session = conn ? core.registry.ensure(conn).data.session.get(route.sessionID) : undefined
      if (!session) return
      tabs.newDraft({ server: tabServer(route.serverKey), directory: session.location.directory })
      return
    }
    if (current?.type === "draft") {
      tabs.newDraft({ server: current.server, directory: current.directory })
      return
    }
    const conn = servers[0]
    if (!conn) return
    const projects = core.serverState.projects(core.scope(serverKey(conn)))
    const list = projects.list()
    const project = list.find((item) => item.worktree === projects.last()) ?? list[0]
    if (!project) return
    tabs.newDraft({ server: tabServer(serverKey(conn)), directory: project.worktree })
  }

  return { home, current, toggleHome, openNewTab }
}

export function useShellCommands(input: {
  onToggleDebug: () => void
  /** Hides or shows the vertical tabs' sidebar; absent while the tabs sit in the titlebar. */
  onToggleSidebar?: () => void
}) {
  const i18n = useI18n()
  const platform = usePlatform()
  const check = useUpdaterCheck()
  const tabs = useTabs()
  const navigate = useNavigate()
  const history = useWindowHistory()
  const actions = useShellActions()
  const core = useCore()
  const selection = useHomeSelection()
  const pickDirectory = useDirectoryPicker()
  const view = i18n.t("command.category.view")
  const projectCategory = i18n.t("command.category.project")
  const conn = selection.focused
  /** The project before or after the one Home shows, shown on Home. */
  const stepProject = (offset: -1 | 1) => {
    if (!conn) return
    const key = serverKey(conn)
    const worktrees = core.serverState
      .projects(core.scope(key))
      .list()
      .map((project) => project.worktree)
    const directory = adjacentHomeProject(worktrees, selection.value.directory, offset)
    if (!directory) return
    selection.set({ server: key, directory })
    navigate("/")
  }
  useCommandRegistration("shell", () => [
    {
      id: "home.toggle",
      title: i18n.t("home.title"),
      category: view,
      // Buff (#470): mod+b only on macOS; on Linux Ctrl+B sends a session to the background.
      keybind: isMac() ? "mod+b" : "alt+home",
      hidden: true,
      onSelect: actions.toggleHome,
    },
    {
      id: "tab.new",
      title: i18n.t("command.session.new"),
      keybind: "mod+t,mod+n",
      hidden: true,
      onSelect: actions.openNewTab,
    },
    ...(actions.current
      ? [
          {
            id: "tab.close",
            title: i18n.t("command.tab.close"),
            keybind: "mod+w",
            hidden: true,
            onSelect: () => {
              const current = actions.current
              if (!current) return
              tabs.closeTab(tabs.tabs().findIndex((tab) => tabKey(tab) === tabKey(current)))
            },
          },
        ]
      : []),
    // A session registers its own (with /new); outside one the menu's File › New Session still opens a draft.
    {
      id: "session.new",
      title: i18n.t("command.session.new"),
      category: i18n.t("command.category.session"),
      keybind: "mod+shift+s",
      onSelect: actions.openNewTab,
    },
    {
      id: "tab.reopenClosed",
      title: i18n.t("command.tab.reopenClosed"),
      category: i18n.t("command.category.file"),
      keybind: "mod+shift+t",
      onSelect: tabs.reopenClosedTab,
    },
    { id: "common.goBack", title: i18n.t("common.goBack"), category: view, keybind: "mod+[", onSelect: history.back },
    {
      id: "common.goForward",
      title: i18n.t("common.goForward"),
      category: view,
      keybind: "mod+]",
      onSelect: history.forward,
    },
    {
      id: "sidebar.toggle",
      title: i18n.t("command.sidebar.toggle"),
      category: view,
      disabled: !input.onToggleSidebar,
      onSelect: () => input.onToggleSidebar?.(),
    },
    {
      id: "project.open",
      title: i18n.t("command.project.open"),
      category: projectCategory,
      disabled: !conn,
      onSelect: () => {
        if (!conn) return
        void pickDirectory(conn, { multiple: true }).then((directories) => {
          if (directories.length === 0) return
          openHomeProjects(core, conn, directories)
          navigate("/")
        })
      },
    },
    {
      id: "project.previous",
      title: i18n.t("command.project.previous"),
      category: projectCategory,
      disabled: !conn,
      onSelect: () => stepProject(-1),
    },
    {
      id: "project.next",
      title: i18n.t("command.project.next"),
      category: projectCategory,
      disabled: !conn,
      onSelect: () => stepProject(1),
    },
    {
      id: "debugBar.toggle",
      title: i18n.t("command.debugBar.toggle"),
      category: view,
      onSelect: input.onToggleDebug,
    },
    {
      id: "settings.open",
      title: i18n.t("command.settings.open"),
      category: i18n.t("command.category.settings"),
      keybind: "mod+comma",
      onSelect: () => navigate("/settings"),
    },
    ...(platform.platform === "desktop" && platform.exportDebugLogs
      ? [
          {
            id: "logs.export",
            title: i18n.t("command.logs.export"),
            category: i18n.t("command.category.settings"),
            onSelect: () => void platform.exportDebugLogs?.(),
          },
        ]
      : []),
    // The beta channel's menu asks the window, which shows the check's progress and result.
    ...(platform.updater
      ? [
          {
            id: "app.checkForUpdates",
            title: i18n.t("desktop.menu.checkForUpdates"),
            hidden: true,
            onSelect: () => void check(),
          },
        ]
      : []),
    ...PAGE_ENTRIES.map((page) => ({
      id: page.action,
      title: i18n.buff.t(page.title),
      category: "Buff",
      onSelect: () => navigate(page.path),
    })),
  ])
  return actions
}
