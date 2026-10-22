// The file browser (#584): the Solid SessionFileBrowserTab — the workspace's tree (or the search
// results while the filter has text) beside the opened file. The "Open file" tab shows the tree
// with a prompt to pick a file; a click previews a file, a double click or Enter keeps it open.

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { FolderTree } from "lucide-react"
import { useId, useState, type Ref } from "react"
import { useI18n } from "../../../i18n/provider"
import { useConnection } from "../../../react/core"
import { useStore } from "../../../react/use-store"
import type { PanesLayout } from "../layout"
import { FilePanel, ReviewSidebar } from "../review/panel"
import type { Server } from "../../../core/servers"
import type { Files } from "./model"
import { applyFileListKeyDown, FileList, FileTree, type Kind } from "./tree"
import { FileView } from "./view"

const NONE: string[] = []

export function FileBrowser(props: {
  server: Server
  files: Files
  layout: PanesLayout
  sessionKey: string
  title: string
  tab: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, Kind>
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  filterRef?: Ref<HTMLInputElement>
}) {
  const i18n = useI18n()
  const results = `session-file-browser-results-${useId().replaceAll(":", "")}`
  const connected = useConnection(props.server).status === "connected"
  const panel = useStore(props.layout.panel, (value) => value)
  const [filter, setFilter] = useState("")
  const [explicit, setExplicit] = useState<string>()
  const query = filter.trim()
  const search = useQuery({
    queryKey: [props.server.key, "session-open-file", props.files.directory, query],
    enabled: connected && query.length > 0,
    queryFn: ({ signal }) => props.files.searchFiles(query, { limit: 200, signal }),
    placeholderData: keepPreviousData,
  })
  const found = !query || search.isPending ? NONE : [...new Set(search.data ?? NONE)]
  const highlighted = found.length === 0 ? undefined : explicit && found.includes(explicit) ? explicit : found[0]
  const optionID = (path: string) => `${results}-option-${found.indexOf(path)}`
  const loading = query.length > 0 && search.isPending

  const list = (() => {
    if (!query)
      return (
        <FileTree
          files={props.files}
          active={props.active}
          kinds={props.kinds}
          onFileClick={(node) => props.onSelect(node.path)}
          onFileDoubleClick={(node) => props.onSelectPermanent(node.path)}
        />
      )
    if (loading)
      return (
        <div role="status" className="ui-note px-2 py-2">
          {i18n.t("common.loading")}
          {i18n.t("common.loading.ellipsis")}
        </div>
      )
    if (found.length === 0)
      return (
        <div role="status" className="ui-note px-2 py-2">
          {i18n.t("palette.empty")}
        </div>
      )
    return (
      <FileList
        id={results}
        role="listbox"
        optionID={optionID}
        files={found}
        kinds={props.kinds}
        active={props.active}
        highlighted={highlighted}
        onFileClick={(path) => {
          setExplicit(path)
          props.onSelect(path)
        }}
        onFileDoubleClick={props.onSelectPermanent}
      />
    )
  })()

  return (
    <FilePanel
      toolbar={false}
      sidebar={
        <ReviewSidebar
          open={props.placeholder || panel.sidebarOpened}
          title={<span className="truncate">{props.title}</span>}
          filter={filter}
          onFilterChange={setFilter}
          onFilterKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault()
              return setFilter("")
            }
            if (!query) return
            applyFileListKeyDown(event, found, highlighted, {
              onHighlight: setExplicit,
              onSelect: props.onSelectPermanent,
            })
          }}
          filterRef={props.filterRef}
          filterControls={results}
          filterActiveDescendant={highlighted ? optionID(highlighted) : undefined}
          filterExpanded={query.length > 0 && found.length > 0}
          width={panel.sidebarWidth}
          onWidthChange={props.layout.resizeSidebar}
        >
          {list}
        </ReviewSidebar>
      }
    >
      {props.placeholder ? (
        <div data-slot="session-review-v2-empty">
          <div className="flex flex-col items-center gap-2 text-center">
            <FolderTree aria-hidden className="mb-2 size-6" />
            <div className="ui-title">{i18n.t("command.file.open")}</div>
            <div className="ui-note">{i18n.t("session.files.selectToOpen")}</div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <FileView key={props.tab} files={props.files} tab={props.tab} sessionKey={props.sessionKey} />
        </div>
      )}
    </FilePanel>
  )
}
