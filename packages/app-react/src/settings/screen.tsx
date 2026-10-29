// The settings screen (#584), ported from the Solid window's settings/shell.tsx: the window's own
// pages and, with one server, that server's pages beside them; with several servers each has its
// own nested pages, and a project opens its own pages inside its server's. Esc and «Back» step out
// one level, then leave settings through the window's history.

import "./settings.css"
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { useCommandRegistration } from "../commands/provider"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { useStore } from "../react/use-store"
import { useMobile } from "../shell/media"
import { useSettings } from "../shell/settings-context"
import { useSettingsState, useSettingsSurface } from "./context"
import { pageIcons, pageLabel, pageLabels } from "./icons"
import { displayName, knownProject, type SettingsServer } from "./inventory"
import { SettingsNavigation, type SettingsNavGroup } from "./navigation"
import { SettingsAbout } from "./pages/about"
import { SettingsAppearance } from "./pages/appearance"
import { SettingsExperimental } from "./pages/experimental"
import { SettingsExtensions } from "./pages/extensions"
import { SettingsGeneral } from "./pages/general"
import { SettingsModels } from "./pages/models"
import { SettingsNotifications } from "./pages/notifications"
import { SettingsPhone } from "./pages/phone"
import { SettingsProjectGeneral } from "./pages/project"
import { SettingsProjects } from "./pages/projects"
import { SettingsProviders } from "./pages/providers"
import { SettingsServerGeneral } from "./pages/server"
import { SettingsShortcuts } from "./pages/shortcuts"
import { SettingsWorkspaces } from "./pages/workspaces"
import { revealSettingsSearch } from "./reveal"
import { SettingsScopeProvider, useSettingsScope } from "./scope"
import type { SettingsRootTab, SettingsView } from "./surface"
import { useSettingsProjects, useSettingsServers } from "./use-inventory"
import { AddServerMenu, useAddServer } from "../servers/add-server"
import { useServer, useServerData } from "../react/core"
import { useWorkspacesPrefetch } from "./projects/prefetch"
import type { ServerConnection } from "../core/servers"

const clientTabs = [
  { value: "general", label: "settings.tab.preferences" },
  { value: "appearance", label: "settings.general.section.appearance" },
  { value: "notifications", label: "settings.tab.notifications" },
  { value: "shortcuts", label: "settings.tab.shortcuts" },
] as const

const scopedTabs = ["projects", "workspaces", "providers", "models", "extensions", "phone"] as const

const scopedRoot: readonly SettingsRootTab[] = [
  "projects",
  "workspaces",
  "providers",
  "models",
  "extensions",
  "phone",
  "servers",
]

export function SettingsScreen() {
  const surface = useSettingsSurface()
  const dialog = useDialog()
  const i18n = useI18n()
  const mobile = useMobile()
  const bottomBar = useSettings((settings) => settings.general.mobileTitlebarPosition === "bottom") && mobile
  const view = useSettingsState((state) => state.view)
  const root = useRef<HTMLDivElement>(null)
  const dialogs = useStore(dialog.entries, (entries) => entries.length)

  useLayoutEffect(() => surface.attach(), [surface])
  useEffect(() => root.current?.focus({ preventScroll: true }), [])

  // Buff (#460): the same keys that open settings close them.
  useCommandRegistration("buff.settings.close", () => [
    {
      id: "settings.open",
      title: i18n.buff.t("Close settings"),
      keybind: "mod+comma",
      hidden: true,
      onSelect: () => surface.close(),
    },
  ])

  // Moving between levels puts the focus back on the screen (or on the search while it shows).
  const type = useRef(view.type)
  useEffect(() => {
    if (type.current === view.type) return
    type.current = view.type
    const search = surface.store.get().search
    const target =
      search.query.trim() && search.expanded
        ? root.current?.querySelector<HTMLInputElement>(".settings-search input")
        : root.current
    target?.focus({ preventScroll: true })
  }, [view.type])

  // A search result reveals its setting once per activation.
  const revealed = useRef(0)
  const activation = useSettingsState((state) => state.search.activation)
  const selected = useSettingsState((state) => state.search.selected)
  useEffect(() => {
    const element = root.current
    if (!element || !selected || !view.searchActivation || view.searchActivation !== activation) return
    if (view.searchActivation === revealed.current) return
    revealed.current = view.searchActivation
    return revealSettingsSearch(element, view)
  }, [view, activation, selected])

  // Buff (#460): Esc leaves settings even when the focus left the screen (a click on empty space).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (root.current?.contains(document.activeElement)) return
      if (dialog.active() || document.querySelector('[role="listbox"], [role="menu"], [role="dialog"]')) return
      escape()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const escape = () => {
    if (surface.view().type !== "root" && surface.search.back()) return
    if (surface.store.get().search.query.trim()) return surface.search.clear()
    surface.back()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || dialogs > 0) return
    if (document.querySelector('[role="menu"], [role="dialog"]')) return
    event.preventDefault()
    escape()
  }

  return (
    <div
      ref={root}
      data-testid="settings-screen"
      className="settings-screen"
      tabIndex={-1}
      style={{ "--settings-bottom-inset": bottomBar ? "40px" : "0px" } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <Levels view={view} />
    </div>
  )
}

function Levels(props: { view: SettingsView }) {
  const servers = useSettingsServers()
  const surface = useSettingsSurface()
  const view = props.view
  const target = view.type === "root" ? undefined : servers.find((server) => server.key === view.server)

  // A server that left the list, or a project of a server that is not ready, steps back.
  useEffect(() => {
    if (view.type === "root") return
    if (!target) return surface.back()
    if (view.type === "project" && !target.connection) surface.openServer(target.key)
  }, [view, target])
  // With one server its pages are the window's own.
  useEffect(() => {
    if (view.type !== "server" || servers.length !== 1) return
    surface.open(view.tab === "general" ? "servers" : view.tab)
  }, [view, servers.length])

  if (view.type === "root") return <RootSettings view={view} servers={servers} />
  if (!target) return null
  if (view.type === "server") return <ServerSettings view={view} entry={target} />
  if (!target.connection) return null
  return <ProjectSettings view={view} conn={target.connection} />
}

function RootSettings(props: { view: Extract<SettingsView, { type: "root" }>; servers: SettingsServer[] }) {
  const i18n = useI18n()
  const surface = useSettingsSurface()
  const addServer = useAddServer((key) => surface.openServer(key))
  const single = props.servers.length === 1 ? props.servers[0] : undefined
  const multiple = props.servers.length > 1
  const tab = props.view.tab
  const autofocus = !useSettingsState((state) => state.search.selected)
  const prefetchRoot = useWorkspacesPrefetch(single?.connection)
  const [reset, setReset] = useState(0)

  useEffect(() => {
    if (multiple && scopedRoot.includes(tab)) surface.open("general")
  }, [multiple, tab])

  const groups: SettingsNavGroup[] = [
    {
      items: clientTabs.map((item) => ({ value: item.value, icon: pageIcons[item.value], label: i18n.t(item.label) })),
    },
    multiple
      ? {
          label: i18n.t("status.popover.tab.servers"),
          action: <AddServerMenu compact onAddServer={addServer} />,
          items: props.servers.map((server) => ({
            value: `server:${server.key}`,
            icon: pageIcons.servers,
            label: server.name,
          })),
        }
      : {
          items: [
            ...scopedTabs.map((value) => ({
              value,
              icon: pageIcons[value],
              label: pageLabel(pageLabels[value], i18n.t, i18n.buff.t),
              disabled: !single?.connection,
              onPrefetch: value === "workspaces" ? prefetchRoot : undefined,
            })),
            { value: "servers", icon: pageIcons.servers, label: i18n.t("settings.section.server") },
          ],
        },
    { items: [{ value: "experimental", icon: pageIcons.experimental, label: i18n.t("settings.tab.experimental") }] },
    { items: [{ value: "about", icon: pageIcons.about, label: i18n.t("settings.tab.about") }] },
  ]
  const change = (value: string) => {
    if (value.startsWith("server:")) return surface.openServer(value.slice("server:".length))
    if (value === "workspaces") setReset((count) => count + 1)
    surface.select(value)
  }
  const scoped = (body: (conn: ServerConnection) => ReactNode) =>
    single?.connection ? (
      <SettingsScopeProvider conn={single.connection}>{body(single.connection)}</SettingsScopeProvider>
    ) : null

  const page = () => {
    if (tab === "general") return <SettingsGeneral />
    if (tab === "appearance") return <SettingsAppearance />
    if (tab === "notifications") return <SettingsNotifications />
    if (tab === "shortcuts") return <SettingsShortcuts autofocus={autofocus} />
    if (tab === "experimental") return <SettingsExperimental />
    if (tab === "about") return <SettingsAbout />
    if (tab === "servers") return single ? <SettingsServerGeneral entry={single} onAddServer={addServer} /> : null
    if (tab === "projects")
      return scoped((conn) => (
        <SettingsProjects
          onOpenProject={(project) =>
            surface.openProject({ server: single?.key ?? "", project: project.worktree, nested: false })
          }
          key={conn.http.url}
        />
      ))
    if (tab === "workspaces") return scoped(() => <SettingsWorkspaces resetFilter={reset} />)
    if (tab === "providers") return scoped(() => <SettingsProviders />)
    if (tab === "models") return scoped(() => <SettingsModels autofocus={autofocus} />)
    if (tab === "phone") return scoped(() => <SettingsPhone />)
    return scoped(() => <SettingsExtensions subtab={props.view.subtab} onSubtab={(subtab) => surface.subtab(subtab)} />)
  }

  return (
    <SettingsNavigation
      value={tab}
      groups={groups}
      backLabel={i18n.t("settings.backToApp")}
      onBack={() => surface.close()}
      onChange={change}
      mobileAction={multiple ? <AddServerMenu compact onAddServer={addServer} /> : undefined}
      panelClassName={tab === "about" ? "settings-about" : undefined}
    >
      {page()}
    </SettingsNavigation>
  )
}

function ServerSettings(props: { view: Extract<SettingsView, { type: "server" }>; entry: SettingsServer }) {
  const i18n = useI18n()
  const surface = useSettingsSurface()
  const tab = props.view.tab
  const conn = props.entry.connection
  const prefetchServer = useWorkspacesPrefetch(conn)
  const [reset, setReset] = useState(0)
  useEffect(() => {
    if (!conn && tab !== "general") surface.select("general")
  }, [conn, tab])
  const groups: SettingsNavGroup[] = [
    {
      items: [
        { value: "general", icon: pageIcons.servers, label: props.entry.name },
        ...scopedTabs.map((value) => ({
          value,
          icon: pageIcons[value],
          label: pageLabel(pageLabels[value], i18n.t, i18n.buff.t),
          disabled: !conn,
          onPrefetch: value === "workspaces" ? prefetchServer : undefined,
        })),
      ],
    },
  ]
  const page = () => {
    if (tab === "general")
      return <SettingsServerGeneral entry={props.entry} nested onServerChange={(key) => surface.openServer(key)} />
    if (!conn) return null
    return (
      <SettingsScopeProvider conn={conn}>
        {tab === "projects" && (
          <SettingsProjects
            onOpenProject={(project) =>
              surface.openProject({ server: props.entry.key, project: project.worktree, nested: true })
            }
          />
        )}
        {tab === "workspaces" && <SettingsWorkspaces resetFilter={reset} />}
        {tab === "providers" && <SettingsProviders />}
        {tab === "models" && <SettingsModels autofocus />}
        {tab === "phone" && <SettingsPhone />}
        {tab === "extensions" && (
          <SettingsExtensions subtab={props.view.subtab} onSubtab={(subtab) => surface.subtab(subtab)} />
        )}
      </SettingsScopeProvider>
    )
  }
  return (
    <SettingsNavigation
      value={tab}
      groups={groups}
      backLabel={i18n.t("settings.backToSettings")}
      onBack={() => surface.back()}
      onChange={(value) => {
        if (value === "workspaces") setReset((count) => count + 1)
        surface.select(value)
      }}
    >
      {page()}
    </SettingsNavigation>
  )
}

function ProjectSettings(props: { view: Extract<SettingsView, { type: "project" }>; conn: ServerConnection }) {
  const server = useServer(props.conn)
  const projects = useSettingsProjects(server)
  // A closed project still opens (the session's project menu): any project the server knows.
  const known = useServerData(server, (state) =>
    Object.values(state.project.info).find((item) => item.canonical === props.view.project),
  )
  const project =
    projects.find((item) => item.worktree === props.view.project) ?? (known ? knownProject(known) : undefined)
  if (!project) return null
  return (
    <SettingsScopeProvider conn={props.conn} project={project}>
      <ProjectPages view={props.view} name={displayName(project)} projectID={project.id} />
    </SettingsScopeProvider>
  )
}

function ProjectPages(props: { view: Extract<SettingsView, { type: "project" }>; name: string; projectID?: string }) {
  const i18n = useI18n()
  const surface = useSettingsSurface()
  const tab = props.view.tab
  const scope = useSettingsScope()
  const prefetchProject = useWorkspacesPrefetch(scope.conn, props.projectID)
  const groups: SettingsNavGroup[] = [
    {
      items: [
        { value: "general", icon: pageIcons.projects, label: props.name },
        {
          value: "workspaces",
          icon: pageIcons.workspaces,
          label: i18n.t("settings.tab.workspaces"),
          onPrefetch: prefetchProject,
        },
        { value: "extensions", icon: pageIcons.extensions, label: i18n.t("settings.tab.extensions") },
      ],
    },
  ]
  return (
    <SettingsNavigation
      value={tab}
      groups={groups}
      backLabel={i18n.t("settings.backToProjects")}
      onBack={() => surface.back()}
      onChange={(value) => surface.select(value)}
    >
      {tab === "general" && <SettingsProjectGeneral onOpenServer={() => surface.openServer(props.view.server)} />}
      {tab === "workspaces" && <SettingsWorkspaces projectID={props.projectID} />}
      {tab === "extensions" && (
        <SettingsExtensions project subtab={props.view.subtab} onSubtab={(subtab) => surface.subtab(subtab)} />
      )}
    </SettingsNavigation>
  )
}
