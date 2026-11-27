// A project's home (#972, PR-03). Picking a project on Home showed only its chats; this is the
// project itself above them: its name and folder, a new chat in it, its files to look through,
// its instructions and memory, its settings. The same things the phone's project page has.

import { Button } from "@buff/ui/react"
import { getFilename } from "@opencode/util/path"
import { ChevronDown, ChevronRight, FolderOpen, NotebookText, Settings, SquarePen } from "lucide-react"
import { useMemo, useState } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { showToast } from "../shell/notifications/toast"
import { panesWindow } from "../session/panes/window"
import { useCore } from "../react/core"
import { FileTree } from "../session/panes/files/tree"
import type { HomeProject } from "./model"

export function ProjectHome(props: {
  server: Server
  project: HomeProject
  /** The project is on this computer: its folder and files can be opened by the computer's programs. */
  local: boolean
  onNewChat(): void
  onMemory(): void
  onSettings(): void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const platform = usePlatform()
  const [files, setFiles] = useState(false)
  const directory = props.project.worktree
  const name = props.project.name || getFilename(directory)
  return (
    <section
      data-component="buff-project-home"
      aria-label={name}
      className="flex min-w-0 flex-col gap-3 px-1.5 pb-4 md:px-3"
    >
      <div className="min-w-0">
        <h1 className="ui-title ui-title--lg truncate" dir="auto">
          {name}
        </h1>
        <p className="ui-note truncate" dir="ltr" title={directory}>
          {directory}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" data-action="buff-project-new-chat" onClick={props.onNewChat}>
          <SquarePen aria-hidden className="size-4" />
          {t("New chat in the project")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-action="buff-project-files"
          aria-expanded={files}
          onClick={() => setFiles(!files)}
        >
          {files ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
          {t("Files")}
        </Button>
        <Button variant="outline" size="sm" data-action="buff-project-memory" onClick={props.onMemory}>
          <NotebookText aria-hidden className="size-4" />
          {t("Instructions and memory")}
        </Button>
        <Button variant="outline" size="sm" data-action="buff-project-settings" onClick={props.onSettings}>
          <Settings aria-hidden className="size-4" />
          {t("Project settings")}
        </Button>
        {props.local && platform.openPath && (
          <Button
            variant="ghost"
            size="sm"
            data-action="buff-project-reveal"
            onClick={() =>
              void platform.openPath?.(directory).catch((error: unknown) =>
                showToast({
                  variant: "error",
                  title: t("The folder did not open"),
                  description: error instanceof Error ? error.message : String(error),
                }),
              )
            }
          >
            <FolderOpen aria-hidden className="size-4" />
            {t("Open the folder")}
          </Button>
        )}
      </div>
      {files && <ProjectFiles server={props.server} directory={directory} local={props.local} />}
    </section>
  )
}

/** Where a file of the project is on the computer: the tree names files from the project's folder. */
export function fileOnDisk(directory: string, path: string): string {
  if (path.startsWith("/") || /^[a-z]:[\\/]/i.test(path)) return path
  // A Windows folder is joined the Windows way.
  const windows = directory.includes("\\")
  const root = directory.replace(/[\\/]+$/, "")
  return windows ? `${root}\\${path.replaceAll("/", "\\")}` : `${root}/${path}`
}

/** The project's folder as a tree to look through; on this computer a file opens in the program for it. */
function ProjectFiles(props: { server: Server; directory: string; local: boolean }) {
  const i18n = useI18n()
  const core = useCore()
  const platform = usePlatform()
  const { server, directory } = props
  // The window's one model of this folder — the chat's files pane shares it — kept current by
  // the server's events.
  const model = useMemo(
    () =>
      panesWindow(core, (title, description) => showToast({ variant: "error", title, description })).files(
        server,
        directory,
        {
          load: i18n.t("toast.file.loadFailed.title"),
          list: i18n.t("toast.file.listFailed.title"),
          translate: (key) => i18n.t(key as Parameters<typeof i18n.t>[0]),
        },
      ),
    [core, server, directory, i18n],
  )
  const open = props.local ? platform.openPath : undefined
  return (
    <div
      data-slot="buff-project-files"
      className="scroll-view__viewport max-h-[320px] overflow-auto rounded-md border border-border p-1"
      // The transcript's styles hide the bar of such a viewport; here it is the only sign of more.
      style={{ scrollbarWidth: "thin" }}
    >
      <FileTree
        files={model}
        draggable={false}
        {...(open
          ? {
              // A double click, as in a file manager: one click only moves through the tree, and a
              // file the agent wrote is not run by a stray press.
              onFileDoubleClick: (node) =>
                void open(fileOnDisk(directory, node.path)).catch((error: unknown) =>
                  showToast({
                    variant: "error",
                    title: i18n.buff.t("The file did not open"),
                    description: error instanceof Error ? error.message : String(error),
                  }),
                ),
            }
          : {})}
      />
    </div>
  )
}
