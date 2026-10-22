import { createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import path from "path"
import type { SessionInfo } from "@opencode/client"
import { Project } from "@opencode/schema/project"
import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { Locale } from "../util/locale"
import { useTheme } from "../context/theme"
import { useClient } from "../context/client"
import { useLocal } from "../context/local"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { DialogSessionRename } from "./dialog-session-rename"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"
import { n, t } from "../feature-plugins/buff/locale"
import { localeTag } from "../feature-plugins/buff/locale-state"
import { sessionLabel } from "../feature-plugins/buff/session-label"
import { useSessionTabs } from "../context/session-tabs"
import { useStorage } from "../context/storage"
import { useConfig } from "../config"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { projectName } from "../util/project"
import { useLocation } from "../context/location"
import { useSessionMarks } from "../feature-plugins/buff/session-marks"
import { BuffSearch } from "@opencode/schema/buff-search"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const theme = useTheme().surface("dialog")
  const client = useClient()
  const local = useLocal()
  const sessionTabs = useSessionTabs()
  const config = useConfig().data
  const toast = useToast()
  const activeLocation = useLocation()
  const [filter, setFilter] = createSignal("")
  const shortcuts = Keymap.useShortcuts()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [toDelete, setToDelete] = createSignal<string>()
  const [prefs, updatePrefs] = useStorage().store("session-list", {
    initial: { allProjects: config.tabs?.scope !== "cwd" },
  })
  const allProjects = () => prefs.allProjects
  // Buff (#452): закрепление и архив — общие с окном; архив открывается отдельным видом.
  const marks = useSessionMarks()
  const [archive, setArchive] = createSignal(false)
  const failed = (error: unknown) => toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
  const pickerLocation = () =>
    (route.data.type === "session" ? data.session.get(route.data.sessionID)?.location : undefined) ??
    activeLocation.ref ??
    data.location.default()

  const [searchResults, { mutate: setSearchResults }] = createResource(
    () => ({
      query: search().trim(),
      allProjects: allProjects(),
      location: pickerLocation(),
    }),
    async ({ query, allProjects, location }) => {
      try {
        if (!data.location.info(location)) await data.location.sync(location)
        const current = data.location.info(location)
        if (!current) throw new Error("Location unavailable")
        const response = await client.api.session.list({
          ...(allProjects
            ? {}
            : current.project.id === Project.ID.global
              ? { directory: current.directory }
              : {
                  project: current.project.id,
                  subpath: path.relative(current.project.directory, current.directory).replaceAll("\\", "/"),
                }),
          ...(query ? { search: query } : {}),
          limit: 50,
          order: "desc",
          parentID: null,
        })
        return { query, allProjects, sessions: response.data, error: undefined }
      } catch (error) {
        // A transient transport failure must degrade search, not crash the TUI
        // through the root ErrorBoundary when the errored resource is read.
        return { query, allProjects, sessions: [] as SessionInfo[], error }
      }
    },
  )

  // Buff (#453): тот же запрос ищется и в тексте переписки.
  const [contentResults] = createResource(
    () => (BuffSearch.problem(search()) ? undefined : search().trim()),
    (query) =>
      client.api
        .rpc(BuffSearch.Rpc)
        .sessions({ query })
        .catch(() => []),
  )
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const localSessions = createMemo(() => {
    const query = filter().trim().toLowerCase()
    const current = data.location.info(pickerLocation())
    const sessions = data.session
      .list()
      .filter(
        (session) =>
          allProjects() ||
          (session.projectID === current?.project.id && session.location.directory === current.directory),
      )
    if (!query) return sessions
    return sessions.filter(
      (session) => !session.parentID && withTimestampedFallback(session).toLowerCase().includes(query),
    )
  })
  const sessions = createMemo(() => {
    const query = filter().trim()
    const local = localSessions()
    if (query !== search().trim()) return searchResults.latest?.sessions ?? local
    if (searchResults.loading) return searchResults.latest?.sessions ?? []
    const result = searchResults()
    if (result?.query !== query || result.allProjects !== allProjects() || result.error) return local
    return result.sessions
  })
  const searchState = createMemo(() => {
    const query = filter().trim()
    if (query !== search().trim() || searchResults.loading)
      return { message: query ? t("Searching sessions…") : t("Loading sessions…"), error: false }
    const result = searchResults()
    if (result?.query === query && result.error)
      return {
        message: query
          ? t("Could not search sessions. Change the search to try again.")
          : t("Could not load sessions."),
        error: true,
      }
    return { message: query ? t("No sessions found") : t("No sessions available"), error: false }
  })

  const quickSwitchHint = createMemo(() => {
    if (sessionTabs.enabled()) return
    const first = shortcuts.get("session.quick_switch.1")
    const last = shortcuts.get("session.quick_switch.9")
    if (!first || !last) return
    return quickSwitchRange(first, last)
  })
  const quickSwitchFooterHints = createMemo(() => {
    const hint = quickSwitchHint()
    return hint && local.session.slots().length > 0 ? [{ title: t("switch"), label: hint }] : []
  })
  const currentProjectName = createMemo(() => {
    const current = data.location.info(pickerLocation())
    if (!current) return ""
    const project = data.project.get(current.project.id)
    return projectName(project) ?? ""
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    // Buff (#472): заголовок дня — на языке человека (группировка — по-прежнему по toDateString).
    const day = (date: Date) =>
      date.toLocaleDateString(localeTag(), {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    const sessionMap = new Map(
      sessions()
        .filter(
          (session) => !session.parentID && !marks.isSide(session.id) && marks.isArchived(session.id) === archive(),
        )
        .map((session) => [session.id, session]),
    )
    const pinned = archive() ? [] : marks.pinned().filter((sessionID) => sessionMap.has(sessionID))
    const pinnedSet = new Set(pinned)
    const slotByID = new Map(local.session.slots().map((sessionID, index) => [sessionID, index + 1]))

    const option = (session: SessionInfo, category: string) => {
      const directory = session.location.directory
      const project = data.project.get(session.projectID)
      const root = session.subpath ? path.resolve(directory, ...session.subpath.split("/").map(() => "..")) : directory
      const relative = path.relative(project?.canonical ?? root, root)
      const footer =
        relative.startsWith("..") || path.isAbsolute(relative)
          ? Locale.truncate(path.basename(relative), 25)
          : undefined
      const slot = sessionTabs.enabled() ? undefined : slotByID.get(session.id)
      const deleting = toDelete() === session.id
      return {
        title: deleting
          ? t("Press {key} again to confirm", { key: shortcuts.get("session.delete") ?? "" })
          : sessionLabel(withTimestampedFallback(session)),
        value: session.id,
        category,
        footer,
        bg: deleting ? theme.background.action.destructive.focused : undefined,
        fg: deleting ? theme.text.action.destructive.focused : undefined,
        gutter:
          data.session.status(session.id) === "running" ||
          data.session.family(session.id).some((id) => data.session.status(id) === "running")
            ? (color: RGBA) => <Spinner color={color} />
            : slot === undefined
              ? undefined
              : () => <text fg={theme.hue.accent[200]}>{slot}</text>,
      }
    }

    const remaining = [...sessionMap.values()]
      .filter((session) => !pinnedSet.has(session.id))
      .map((session) => {
        const updated = new Date(session.time.updated)
        return option(session, updated.toDateString() === today ? t("Today") : day(updated))
      })

    const listed = new Set([...pinned, ...remaining.map((item) => item.value)])
    const inContent = (BuffSearch.problem(filter()) || archive() ? [] : (contentResults.latest ?? []))
      .filter(
        (result) =>
          !listed.has(result.sessionID) && !marks.isArchived(result.sessionID) && !marks.isSide(result.sessionID),
      )
      .map((result) => ({
        title: result.title || t("Untitled"),
        value: result.sessionID,
        category: t("In the conversation"),
        description: `${t(BuffSearch.ROLE[result.role])}: ${result.fragment.before}«${result.fragment.match}»${result.fragment.after}`,
        footer: BuffSearch.moreLabel(result.more, n),
        bg: undefined,
        fg: undefined,
        gutter: undefined,
      }))
    return [...pinned.map((sessionID) => option(sessionMap.get(sessionID)!, t("Pinned"))), ...remaining, ...inContent]
  })

  onMount(() => dialog.setSize("large"))

  return (
    <DialogSelect
      title={t("Sessions")}
      titleView={
        <box flexDirection="row">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            {archive() ? t("Session archive") : t("Sessions")}
          </text>
          <Show when={!allProjects() && currentProjectName()}>
            <text fg={theme.text.muted}> {t("for {project}", { project: currentProjectName() })}</text>
          </Show>
        </box>
      }
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={(query) => {
        setFilter(query)
        setSearch(query)
      }}
      bindings={[
        {
          bind: "ctrl+a",
          title: allProjects() ? t("Show current directory sessions") : t("Show all project sessions"),
          group: t("Dialog"),
          run: () => {
            void updatePrefs((draft) => {
              draft.allProjects = !draft.allProjects
            }).catch(() => {})
          },
        },
        {
          bind: "ctrl+y",
          title: archive() ? t("Show sessions") : t("Show archive"),
          group: t("Dialog"),
          run: () => setArchive(!archive()),
        },
      ]}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={searchState().error ? theme.text.feedback.error.base : theme.text.muted}>
            {searchState().message}
          </text>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={searchState().error ? theme.text.feedback.error.base : theme.text.muted}>
            {searchState().message}
          </text>
        </box>
      }
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: t("pin/unpin"),
          hidden: archive(),
          onTrigger: (option) => {
            const on = !marks.isPinned(option.value)
            void marks.change({ type: "pin", sessionID: option.value, on }).catch(failed)
            // Быстрые слоты (без вкладок) ведёт прежнее локальное закрепление — держим их в ногу.
            if (!sessionTabs.enabled() && local.session.isPinned(option.value) !== on)
              local.session.togglePin(option.value)
          },
        },
        {
          command: "session.archive.toggle",
          title: archive() ? t("out of archive") : t("to archive"),
          onTrigger: (option) =>
            void marks.change({ type: "archive", sessionID: option.value, on: !archive() }).catch(failed),
        },
        {
          command: "session.delete",
          title: t("delete"),
          onTrigger: (option: { value: string }) => {
            if (toDelete() !== option.value) {
              setToDelete(option.value)
              return
            }
            void client.api.session
              .remove({ sessionID: option.value })
              .then(() => {
                setSearchResults((result) =>
                  result
                    ? { ...result, sessions: result.sessions.filter((session) => session.id !== option.value) }
                    : result,
                )
              })
              .catch((error) => {
                setToDelete(undefined)
                toast.show({
                  message: t("Failed to delete session: {error}", { error: errorMessage(error) }),
                  variant: "error",
                  duration: 5000,
                })
              })
          },
        },
        {
          command: "session.rename",
          title: t("rename"),
          onTrigger: (option: { value: string; title: string }) =>
            DialogSessionRename.show(dialog, option.value, option.title),
        },
      ]}
      footerHints={[
        ...quickSwitchFooterHints(),
        { title: allProjects() ? t("current directory") : t("all projects"), label: "ctrl+a", side: "right" },
        { title: archive() ? t("sessions") : t("archive"), label: "ctrl+y", side: "right" },
      ]}
    />
  )
}

function quickSwitchRange(first: string, last: string) {
  const prefix = first.slice(0, -1)
  if (first.endsWith("1") && last === `${prefix}9`) return `${prefix}1-9`
  return t("{first} through {last}", { first, last })
}
