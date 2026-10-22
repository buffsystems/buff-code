// File changes (#584): edit, write and patch calls, each file a section with its diff.

import { changedFileDiff, patchFileGroups } from "@opencode/session-ui/apply-patch-file"
import { resolveFileDiff } from "@opencode/session-ui/session-diff"
import { useMemo, useRef, useState, type ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"
import { BasicTool } from "../parts/basic-tool"
import { DiffView, TextView } from "./code-view"
import {
  DiagnosticsDisplay,
  DiffChanges,
  FileAccordionGroup,
  FileAccordionItem,
  FileHeader,
  ToolFileAccordion,
  useVisibleAfterOpen,
} from "./common"
import { getDiagnostics } from "./info"
import type { ToolProps } from "./types"

/** The locked title row of a file change, with its file count. */
function FileTool(props: ToolProps & { title: string; count: number; children?: ReactNode }) {
  const i18n = useI18n()
  return (
    <BasicTool
      status={props.status}
      hideDetails={props.hideDetails}
      open
      locked
      hasContent
      trigger={{
        title: props.title,
        subtitle: props.count > 0 ? `${props.count} ${i18n.plural("ui.common.file", props.count)}` : "",
      }}
    >
      {props.children}
    </BasicTool>
  )
}

export function EditTool(props: ToolProps) {
  const i18n = useI18n()
  const inputPath = typeof props.input.path === "string" ? props.input.path : ""
  const files = props.metadata.files
  const diff = Array.isArray(files) ? files.find(changedFileDiff) : undefined
  const diagnostics = getDiagnostics(props.metadata.diagnostics, inputPath)
  const path = typeof diff?.file === "string" ? diff.file : inputPath
  const pending = props.status === "streaming" || props.status === "running"
  const patch = typeof diff?.patch === "string" ? diff.patch : undefined
  const resolved = useMemo(() => {
    if (!diff) return undefined
    try {
      return resolveFileDiff({ file: path, patch })
    } catch {
      return undefined
    }
  }, [!!diff, path, patch])
  const oldString = typeof props.input.oldString === "string" ? props.input.oldString : ""
  const newString = typeof props.input.newString === "string" ? props.input.newString : ""
  const pair = useMemo(
    () => ({ before: { name: path, contents: oldString }, after: { name: path, contents: newString } }),
    [path, oldString, newString],
  )
  return (
    <div data-component="edit-tool">
      <FileTool {...props} title={i18n.t("ui.messagePart.title.edit")} count={path ? 1 : 0}>
        {path && (
          <ToolFileAccordion
            path={path}
            defaultOpen={props.defaultOpen}
            open={props.open}
            onOpenChange={props.onOpenChange}
            forceOpen={props.forceOpen}
            defer={props.deferContent !== false}
            actions={!pending && diff ? <DiffChanges changes={diff} /> : undefined}
          >
            <div data-component="edit-content">
              {resolved ? (
                <DiffView fileDiff={resolved} onRendered={props.onContentRendered} />
              ) : (
                <DiffView before={pair.before} after={pair.after} onRendered={props.onContentRendered} />
              )}
            </div>
          </ToolFileAccordion>
        )}
        <DiagnosticsDisplay diagnostics={diagnostics} />
      </FileTool>
    </div>
  )
}

export function WriteTool(props: ToolProps) {
  const path = typeof props.input.path === "string" ? props.input.path : ""
  const content = typeof props.input.content === "string" ? props.input.content : ""
  const diagnostics = getDiagnostics(props.metadata.diagnostics, path)
  const file = useMemo(() => ({ name: path, contents: content }), [path, content])
  return (
    <div data-component="write-tool">
      {content && path && (
        <ToolFileAccordion
          path={path}
          defaultOpen={props.defaultOpen}
          open={props.open}
          onOpenChange={props.onOpenChange}
          forceOpen={props.forceOpen}
          defer={props.deferContent !== false}
        >
          <div data-component="write-content">
            <TextView file={file} onRendered={props.onContentRendered} />
          </div>
        </ToolFileAccordion>
      )}
      <DiagnosticsDisplay diagnostics={diagnostics} />
    </div>
  )
}

type PatchGroup = ReturnType<typeof patchFileGroups>[number]

function PatchFile(props: {
  file: PatchGroup
  open: boolean
  onOpenChange: (open: boolean) => void
  deferContent?: boolean
  onContentRendered?: () => void
}) {
  const i18n = useI18n()
  const visible = useVisibleAfterOpen(props.open)
  const file = props.file
  const actions =
    file.type === "add" ? (
      <span data-slot="apply-patch-change" data-type="added" className="tool-files__change">
        {i18n.t("ui.patch.action.created")}
      </span>
    ) : file.type === "delete" ? (
      <span data-slot="apply-patch-change" data-type="removed" className="tool-files__change">
        {i18n.t("ui.patch.action.deleted")}
      </span>
    ) : (
      <DiffChanges changes={{ additions: file.additions, deletions: file.deletions }} />
    )
  return (
    <FileAccordionItem
      open={props.open}
      onOpenChange={props.onOpenChange}
      type={file.type}
      header={<FileHeader path={file.path} actions={actions} />}
    >
      {(props.deferContent === false || visible) &&
        file.views.map((view, index) => (
          <div key={index} data-component="apply-patch-file-diff">
            <DiffView fileDiff={view.fileDiff} onRendered={props.onContentRendered} />
          </div>
        ))}
    </FileAccordionItem>
  )
}

export function PatchTool(props: ToolProps) {
  const i18n = useI18n()
  const source = props.metadata.files
  const files = useMemo(() => patchFileGroups(source), [source])
  const [expanded, setExpanded] = useState<string[]>([])
  const title =
    props.tool === "edit"
      ? i18n.t("ui.messagePart.title.edit")
      : props.tool === "write"
        ? i18n.t("ui.messagePart.title.write")
        : i18n.t("ui.tool.patch")
  const open = props.fileOpen
    ? files.flatMap((file) => (props.fileOpen?.(file.path) === true ? [file.path] : []))
    : expanded
  const latest = useRef(open)
  latest.current = open
  const change = (next: string[]) => {
    if (!props.onFileOpenChange) return setExpanded(next)
    files.forEach((file) => props.onFileOpenChange?.(file.path, next.includes(file.path)))
  }
  return (
    <div data-component="apply-patch-tool">
      {files.length > 0 ? (
        <FileAccordionGroup>
          {files.map((file) => (
            <PatchFile
              key={file.path}
              file={file}
              open={open.includes(file.path)}
              onOpenChange={(value) =>
                change(
                  value ? [...latest.current, file.path] : latest.current.filter((path) => path !== file.path),
                )
              }
              deferContent={props.deferContent}
              onContentRendered={props.onContentRendered}
            />
          ))}
        </FileAccordionGroup>
      ) : (
        <FileTool {...props} title={title} count={0} />
      )}
    </div>
  )
}
