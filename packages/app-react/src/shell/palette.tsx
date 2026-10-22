// What the command palette searches and opens from where the window is (#584): the shown
// session's files (through the side panes' contract) or a new session's project files, and the
// server's sessions — on Home the commands and sessions only, as in the Solid window's home palette.

import { getFilename } from "@opencode/util/path"
import { useMemo } from "react"
import { usePaletteContext } from "../commands/provider"
import { fileEntry, sessionSource, type PaletteSource } from "../commands/palette-entries"
import type { PaletteContext } from "../commands/palette"
import { serverKey } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { useCore, useServers } from "../react/core"
import { useStore } from "../react/use-store"
import { useLocation, useRoute } from "../router/router"
import { sideActions } from "../session/panes/side-actions"
import { useTabs } from "./tabs/provider"
import { tabServer, type DraftTab } from "./tabs/tabs"

export function usePaletteSources() {
  const i18n = useI18n()
  const core = useCore()
  const tabs = useTabs()
  const route = useRoute()
  const servers = useServers()
  const location = useLocation()
  const session = route.name === "session"
  const draftID = route.name === "new-session" ? new URLSearchParams(location.search).get("draftId") : undefined
  const draft = useStore(tabs.list, (list) =>
    list.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === draftID),
  )
  const serverOf = session ? route.serverKey : draft?.server
  const conn = serverOf ? servers.find((item) => serverKey(item) === serverOf) : servers[0]
  const files = i18n.t("palette.group.files")
  const untitled = i18n.t("command.session.new")
  const category = i18n.t("command.category.session")

  const context = useMemo<PaletteContext>(() => {
    const server = conn ? core.registry.ensure(conn) : undefined
    // A new session searches its project's files, as the Solid window's draft palette does.
    const searchDraft = (query: string, signal: AbortSignal) =>
      !server || !draft
        ? Promise.resolve([])
        : server
            .api()
            .file.find({ location: { directory: draft.directory }, query, type: "file" }, { signal })
            .then((result) => result.data.map((entry) => entry.path))
    const fileSource: PaletteSource = async (query, signal) => {
      if (!query) return []
      const actions = sideActions()
      const paths = actions ? await actions.searchFiles(query, signal) : await searchDraft(query, signal)
      return paths.map((path) => fileEntry(path, files))
    }
    const sessions = server
      ? sessionSource({
          server: server.key,
          load: (search, signal) =>
            server
              .api()
              .session.list({ parentID: null, search, limit: 50 }, { signal })
              .then((result) => result.data),
          get: (sessionID, signal) => server.api().session.get({ sessionID }, { signal }),
          project: (info) => {
            const project = server.data.project.get(info.projectID)
            return project?.name || getFilename(info.location.directory)
          },
          untitled,
          category,
        })
      : undefined
    return {
      home: !session && !draft,
      sources: [...(session || draft ? [fileSource] : []), ...(sessions ? [sessions] : [])],
      recentFiles: () => sideActions()?.recentFiles() ?? { paths: [] },
      openFile: (path) => sideActions()?.openFile(path),
      openSession: (entry) => {
        if (!entry.server || !entry.sessionID) return
        tabs.select(tabs.addSessionTab({ server: tabServer(entry.server), sessionId: entry.sessionID }))
      },
    }
  }, [core, conn, session, draft, tabs, files, untitled, category])
  usePaletteContext(context)
}
