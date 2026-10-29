// Where the settings screen is (#584), ported from the Solid window's surface.tsx: the view — the
// window-wide pages, a server's pages or a project's pages, with the setting a search result
// points at — and the search state. The Solid window keeps the view in the history entry; here it
// is a store the screen owns, one per window, and the route stays "/settings".

import { lastSettingsTab, rememberSettingsTab } from "@opencode/app/react-reuse/settings-memory"
import { createStore } from "../core/store"

export const rootTabs = [
  "general",
  "appearance",
  "notifications",
  "shortcuts",
  "projects",
  "workspaces",
  "providers",
  "models",
  "extensions",
  "phone",
  "servers",
  "experimental",
  "about",
] as const
export const serverTabs = ["general", "projects", "workspaces", "providers", "models", "extensions", "phone"] as const
export const projectTabs = ["general", "workspaces", "extensions"] as const

export type SettingsRootTab = (typeof rootTabs)[number]
export type SettingsServerTab = (typeof serverTabs)[number]
export type SettingsProjectTab = (typeof projectTabs)[number]
export type SettingsSubtab = "mcps" | "plugins" | "skills" | "commands" | "agents" | "hooks" | "memory" | "lsps"

export type SettingsView = (
  | { type: "root"; tab: SettingsRootTab }
  | { type: "server"; server: string; tab: SettingsServerTab }
  | { type: "project"; server: string; project: string; tab: SettingsProjectTab; parent: "root" | "server" }
) & { target?: string; subtab?: SettingsSubtab; searchActivation?: number }

export type SettingsSearchState = {
  query: string
  origin?: SettingsView
  selected: string
  highlighted: string
  scrollTop: number
  activation: number
  expanded: boolean
}

export type SettingsSurfaceState = { view: SettingsView; search: SettingsSearchState }

const freshSearch = (activation: number): SettingsSearchState => ({
  query: "",
  origin: undefined,
  selected: "",
  highlighted: "",
  scrollTop: 0,
  activation,
  expanded: true,
})

const includes = <Tab extends string>(tabs: readonly Tab[], value: string): value is Tab =>
  tabs.some((tab) => tab === value)

/** The view after picking a tab of the current level; a tab of another level changes nothing. */
export function selectTab(view: SettingsView, tab: string): SettingsView {
  const clean = { target: undefined, subtab: undefined }
  if (view.type === "root" && includes(rootTabs, tab)) return { ...view, ...clean, tab }
  if (view.type === "server" && includes(serverTabs, tab)) return { ...view, ...clean, tab }
  if (view.type === "project" && includes(projectTabs, tab)) return { ...view, ...clean, tab }
  return { ...view, ...clean }
}

/** One level up: a project to its server's (or the window's) projects, a server to the window. */
export function parentView(view: SettingsView): SettingsView | undefined {
  if (view.type === "root") return undefined
  if (view.type === "server" || view.parent === "root")
    return { type: "root", tab: view.type === "server" ? "general" : "projects" }
  return { type: "server", server: view.server, tab: "projects" }
}

/**
 * The settings surface of one window: a view change while settings are closed routes the window to
 * them (`show`); leaving goes back through the window's history (`goBack`). Moving between pages
 * stays on one history entry.
 */
export function createSettingsSurface(input: { show: () => void; goBack: () => void }) {
  const store = createStore<SettingsSurfaceState>({
    view: { type: "root", tab: lastSettingsTab(rootTabs) },
    search: freshSearch(0),
  })
  const state = { active: false }
  const setView = (view: SettingsView) => {
    store.set((current) => ({ ...current, view }))
    if (view.type === "root") rememberSettingsTab(view.tab)
    if (!state.active) input.show()
  }
  const setSearch = (patch: Partial<SettingsSearchState>) =>
    store.set((current) => ({ ...current, search: { ...current.search, ...patch } }))
  const view = () => store.get().view
  const search = () => store.get().search

  return {
    store,
    view,
    active: () => state.active,
    /** The screen mounts and unmounts; leaving resets the search like the Solid window does. */
    attach() {
      state.active = true
      return () => {
        state.active = false
        setSearch(freshSearch(search().activation))
      }
    },
    /** Open the window's pages; without a tab, the one settings were last closed on. */
    open(tab?: SettingsRootTab) {
      setView({ type: "root", tab: tab ?? lastSettingsTab(rootTabs) })
    },
    openServer(server: string, tab: SettingsServerTab = "general") {
      setView({ type: "server", server, tab })
    },
    openProject(input: { server: string; project: string; tab?: SettingsProjectTab; nested: boolean }) {
      setView({
        type: "project",
        server: input.server,
        project: input.project,
        parent: input.nested ? "server" : "root",
        tab: input.tab ?? "general",
      })
    },
    select(tab: string) {
      setView(selectTab(view(), tab))
    },
    subtab(subtab: SettingsSubtab | undefined) {
      setView({ ...view(), subtab, target: undefined })
    },
    back() {
      const parent = parentView(view())
      if (!parent) return input.goBack()
      setView(parent)
    },
    close() {
      if (state.active) input.goBack()
    },
    search: {
      input(query: string) {
        const current = search()
        const origin = !current.query.trim() && query.trim() ? { ...view(), target: undefined } : current.origin
        setSearch({ query, origin, highlighted: "", scrollTop: 0, expanded: true })
        if (!query.trim()) setSearch({ selected: "", origin: undefined })
      },
      expand: () => setSearch({ expanded: true }),
      highlight: (id: string) => setSearch({ highlighted: id }),
      scroll: (scrollTop: number) => setSearch({ scrollTop }),
      open(destination: SettingsView, id: string) {
        const activation = search().activation + 1
        setSearch({ selected: id, highlighted: id, expanded: false, activation })
        setView({ ...destination, searchActivation: activation })
      },
      clear: () => setSearch({ ...freshSearch(search().activation) }),
      /** Back from a result to where the search started; false when there is nowhere to go. */
      back() {
        const current = search()
        if (!current.query.trim() || !current.selected || !current.origin) return false
        setView(current.origin)
        setSearch({ selected: "", expanded: true })
        return true
      },
    },
  }
}

export type SettingsSurface = ReturnType<typeof createSettingsSurface>
