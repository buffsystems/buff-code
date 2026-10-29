// Home (#584): the projects of the focused server and its recent sessions by day — search, open,
// rename, export and delete — ported from the Solid Home. Keeps its ARIA names and data-component
// attributes, so its e2e specs can drive it.

import { ConfirmDialog, EmptyState } from "@buff/ui/react"
import { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import { BuffLinks } from "@opencode/schema/buff-links"
import { HOME_SESSION_LIMIT, loadHomeSessionIndex } from "@opencode/app/react-reuse/home-session-index"
import { removedSessionIDs } from "@opencode/app/react-reuse/session-domain"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@opencode/app/react-reuse/session-export"
import { sessionLabel, sessionTitle } from "@opencode/app/react-reuse/session-title"
import type { SessionInfo } from "@opencode/client/promise"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { serverKey, serverName, type Server, type ServerConnection } from "../core/servers"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useConnection, useCore, useServer, useServerData, useServerProjects, useServers } from "../react/core"
import { useNavigate } from "../router/router"
import { useSettingsSurface } from "../settings/context"
import { useDirectoryPicker } from "../shell/directory-picker/picker"
import { useMobile } from "../shell/media"
import { showToast } from "../shell/notifications/toast"
import { useTabList, useTabs } from "../shell/tabs/provider"
import { findSessionTab, tabServer } from "../shell/tabs/tabs"
import { useSessionMarks } from "./marks"
import { displayName, groupSessions, homeProjects, homeRecords, toggleHomeSelection, type HomeProject } from "./model"
import { HomeProjects, HomeUtilityNav, type HomeProjectsProps } from "./projects"
import { useHomeSearch } from "./search"
import { HomeSessions, type HomeSessionActions, type OpenOptions } from "./sessions"
import { openHomeProjects, useHomeSelection } from "./selection"

export function Home() {
  const servers = useServers()
  const i18n = useI18n()
  const selection = useHomeSelection()
  const conn = selection.focused
  if (!conn || servers.length === 0) return <EmptyState>{i18n.t("home.sessions.empty")}</EmptyState>
  return <ServerHome key={serverKey(conn)} conn={conn} selection={selection} />
}

function ServerHome(props: { conn: ServerConnection; selection: ReturnType<typeof useHomeSelection> }) {
  const i18n = useI18n()
  const core = useCore()
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const settingsSurface = useSettingsSurface()
  const navigate = useNavigate()
  const dialog = useDialog()
  const tabs = useTabs()
  const tabList = useTabList()
  const mobile = useMobile()
  const client = useQueryClient()
  const servers = useServers()
  const server = useServer(props.conn)
  const key = server.key
  const connection = useConnection(server)
  const projects = useServerProjects(server)
  const known = useServerData(server, (state) => state.project.info)
  const live = useServerData(server, (state) => state.session.info)
  const marks = useSessionMarks(server)
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const selection = props.selection.value
  const queryKey = ["home-sessions", key]
  const index = useQuery({
    queryKey,
    enabled: connection.status === "connected",
    queryFn: ({ signal }) =>
      loadHomeSessionIndex((input, options) => server.api().session.list(input, options), signal),
    retry: false,
    staleTime: 30_000,
  })

  const list = useMemo(() => homeProjects(projects.list, Object.values(known)), [projects.list, known])
  const selected = list.find((item) => item.worktree === selection.directory)
  const hidden = useMemo(() => new Set([...BuffSessionMarks.hidden(marks), ...removed]), [marks, removed])
  const recordsInput = {
    fetched: index.data ?? [],
    known: Object.values(live),
    projects: list,
    directories: selection.directory ? [selection.directory, ...(selected?.sandboxes ?? [])] : undefined,
    hidden,
    now: Date.now(),
  }
  const all = useMemo(
    () => homeRecords({ ...recordsInput, limit: Infinity }),
    [index.data, live, list, selection.directory, hidden],
  )
  // The Solid Home lists the newest 64; search reads them all.
  const records = useMemo(() => all.slice(0, HOME_SESSION_LIMIT), [all])
  const groups = useMemo(
    () =>
      groupSessions(records, new Date(), {
        today: i18n.t("home.sessions.group.today"),
        yesterday: i18n.t("home.sessions.group.yesterday"),
        older: i18n.t("home.sessions.group.older"),
        recent: i18n.t("sidebar.project.recentSessions"),
      }),
    [all, i18n],
  )

  // The first rows are the likeliest to open next: their info loads ahead.
  const prefetched = useRef(new Set<string>())
  useEffect(() => {
    records.slice(0, 2).forEach((record) => {
      if (prefetched.current.has(record.session.id)) return
      prefetched.current.add(record.session.id)
      void server.data.session.sync(record.session.id).catch(() => undefined)
    })
  }, [records[0]?.session.id, records[1]?.session.id])

  const newSessionProject = selected ?? list.find((item) => item.worktree === projects.last()) ?? list[0]
  const openDraft = (directory: string) => {
    projects.open(directory)
    projects.touch(directory)
    tabs.newDraft({ server: tabServer(key), directory })
  }

  const actions: HomeSessionActions = {
    isOpen: (session) => !!findSessionTab(tabList, key, session.id),
    create: newSessionProject ? () => openDraft(newSessionProject.worktree) : undefined,
    open(session, options?: OpenOptions) {
      const directory =
        list.find((item) => item.worktree === session.location.directory)?.worktree ?? session.location.directory
      // The transcript's first page is asked for now, before the session screen even loads (the
      // Solid Home's open): its request leads the screen's own reads instead of queueing behind them.
      if (!options?.background) void server.data.session.message.sync(session.id).catch(() => undefined)
      server.data.session.remember(session)
      const tab = tabs.addSessionTab({ server: tabServer(key), sessionId: session.id })
      projects.open(directory)
      if (options?.background) return
      projects.touch(directory)
      tabs.select(tab)
    },
    async rename(session, title) {
      const next = title.trim()
      if (!next || next === sessionLabel(session, i18n.buff.t)) return true
      return server
        .api()
        .session.update({ sessionID: session.id, title: next })
        .then(() => {
          server.data.session.remember({ ...(server.data.session.get(session.id) ?? session), title: next })
          // A rename moves time.updated on the server; the canonical record keeps the day groups right.
          server.data.session.invalidate(session.id)
          void server.data.session.sync(session.id).catch(() => undefined)
          client.setQueryData<SessionInfo[]>(queryKey, (current) =>
            current?.map((item) => (item.id === session.id ? { ...item, title: next } : item)),
          )
          return true
        })
        .catch((cause: unknown) => {
          showToast({
            title: i18n.t("common.requestFailed"),
            description: errorMessage(cause, i18n.t("common.requestFailed")),
          })
          return false
        })
    },
    async export(session) {
      try {
        const data = await fetchSessionExport({ sessionID: session.id, api: server.api() })
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
    },
    remove(session) {
      const name = sessionTitle(session.title) ?? i18n.t("command.session.new")
      dialog.show((close) => (
        <ConfirmDialog
          open
          danger
          title={i18n.t("session.delete.title")}
          message={i18n.t("session.delete.confirm", { name })}
          confirmLabel={i18n.t("session.delete.button")}
          cancelLabel={i18n.t("common.cancel")}
          onCancel={close}
          onConfirm={() => {
            close()
            void deleteSession(server, session, {
              hide: (ids) => setRemoved((current) => new Set([...current, ...ids])),
              unhide: (ids) => setRemoved((current) => new Set([...current].filter((id) => !ids.includes(id)))),
              removeTabs: (ids) => tabs.removeSessions(key, ids),
              done: () => void client.invalidateQueries({ queryKey, exact: true }),
              failed: (cause) =>
                showToast({
                  title: i18n.t("session.delete.failed.title"),
                  description: errorMessage(cause, i18n.t("session.delete.failed.title")),
                }),
            })
          }}
        />
      ))
    },
  }

  const placeholder = selected
    ? i18n.t("home.sessions.search.placeholder.scoped", { scope: displayName(selected) })
    : servers.length > 1
      ? i18n.t("home.sessions.search.placeholder.scoped", { scope: serverName(props.conn) })
      : i18n.t("home.sessions.search.placeholder")
  const search = useHomeSearch({
    records: all,
    loading: index.isPending && connection.status === "connected",
    placeholder,
    lookup: async (sessionID) => {
      const result = await server.api().session.get({ sessionID })
      if (result.time.archived) return undefined
      return homeRecords({ ...recordsInput, fetched: [result], known: [], hidden: undefined })[0]
    },
    open: (record, options) => actions.open(record.session, options),
  })

  const projectProps: HomeProjectsProps = {
    servers,
    focused: props.conn,
    projects: list,
    recentlyClosed: projects.recentlyClosed,
    selection,
    homedir: "",
    healthy: (conn) => serverKey(conn) !== key || connection.status === "connected",
    onFocusServer: (conn) => props.selection.set({ server: serverKey(conn) }),
    onSelectProject: (conn, directory) =>
      props.selection.set(toggleHomeSelection(selection, serverKey(conn), directory)),
    onChooseProject: (conn) =>
      void pickDirectory(conn, { multiple: true }).then((directories) => projectProps.onAddProjects(conn, directories)),
    onAddProjects: (conn, directories) => openHomeProjects(core, conn, directories),
    onNewSession: (_conn, directory) => openDraft(directory),
    onEditProject: (conn, project) =>
      settingsSurface.openProject({ server: serverKey(conn), project: project.worktree, nested: false }),
    onCloseProject: (conn, directory) => {
      core.serverState.projects(core.scope(serverKey(conn))).close(directory)
      if (selection.server === serverKey(conn) && selection.directory === directory)
        props.selection.set({ server: serverKey(conn) })
    },
    onMoveProject: (conn, directory, index) =>
      core.serverState.projects(core.scope(serverKey(conn))).move(directory, index),
    onOpenSettings: () => navigate("/settings"),
    onOpenHelp: () => platform.openExternal(BuffLinks.localized(BuffLinks.docs, i18n.buff.locale)),
  }

  return (
    <div data-component="home" className="flex min-h-0 flex-1 flex-col self-stretch overflow-hidden">
      {mobile && (
        <div className="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects {...projectProps} dropdown />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto [container-type:size]">
        <div className="mx-auto grid min-h-full w-full max-w-[1080px] gap-4 px-3 max-md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,720px)] lg:gap-8 lg:px-6">
          {!mobile && <HomeProjects {...projectProps} />}
          <HomeSessions
            server={server}
            groups={groups}
            loading={index.isPending && connection.status === "connected"}
            showProjectName={!selected}
            search={search}
            actions={actions}
          />
        </div>
      </div>
      <div className="hidden shrink-0 px-3 py-2 md:block lg:hidden">
        <HomeUtilityNav
          className="flex"
          onOpenSettings={projectProps.onOpenSettings}
          onOpenHelp={projectProps.onOpenHelp}
        />
      </div>
    </div>
  )
}

/** Delete a session and its subagents: hidden at once, their tabs closed, shown again if it fails. */
async function deleteSession(
  server: Server,
  session: SessionInfo,
  on: {
    hide: (ids: string[]) => void
    unhide: (ids: string[]) => void
    removeTabs: (ids: string[]) => void
    done: () => void
    failed: (cause: unknown) => void
  },
) {
  const ids = [...removedSessionIDs(Object.values(server.data.state.get().session.info), session.id)]
  on.hide(ids)
  await server
    .api()
    .session.remove({ sessionID: session.id })
    .then(() => on.removeTabs(ids))
    .catch((cause: unknown) => {
      on.unhide(ids)
      on.failed(cause)
    })
    .finally(on.done)
}

export type { HomeProject }

// The server's own message when it gave one. (The Solid helper's module pulls Solid types in.)
function errorMessage(cause: unknown, fallback: string) {
  if (cause && typeof cause === "object" && "data" in cause) {
    const data = cause.data
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message)
      return data.message
  }
  if (cause instanceof Error) return cause.message
  return fallback
}
