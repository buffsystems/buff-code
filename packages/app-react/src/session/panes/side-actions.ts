// What other parts of the window ask of the side panes (#584): open a file in the shown session's
// panel (the command palette's file results), search its workspace's files, open the Context tab
// (the timeline header's context-usage button). The session screen's panes register the shown
// session here while it is mounted; callers outside the session (the palette dialog) use it.

export type SideActions = {
  /** Open a workspace file as a kept tab and show the side panel. */
  openFile: (path: string) => void
  /** Show the side panel's Context tab. */
  openContext: () => void
  /** The Context tab shown: close it; otherwise show it (the header's context-usage button). */
  toggleContext: () => void
  /** Files of the session's workspace matching a query, workspace-relative. */
  searchFiles: (query: string, signal?: AbortSignal) => Promise<string[]>
  /** The open file tabs' paths and the active one's, for the palette with no query. */
  recentFiles: () => { paths: string[]; active?: string }
}

const current: { value?: SideActions } = {}

export function registerSideActions(actions: SideActions) {
  current.value = actions
  return () => {
    if (current.value === actions) current.value = undefined
  }
}

/** The shown session's side actions, when a session screen is shown. */
export function sideActions(): SideActions | undefined {
  return current.value
}
