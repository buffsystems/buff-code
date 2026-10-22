// Grouped calls (#584): the "Used N …" stack of quiet calls, thoughts and notices, and the
// stack of one turn's file changes — the Solid CurrentContextToolGroup and CurrentFileToolGroup.

import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import {
  currentToolError,
  currentToolHasLoadedFiles,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from "@opencode/session-ui/current-tool-state"
import { noticeGroupTitle } from "@opencode/session-ui/timeline/buff-notice"
import { createTwoFilesPatch, diffLines } from "diff"
import { useRef } from "react"
import { useI18n } from "../../../i18n/provider"
import { BasicTool, Shimmer } from "../parts/basic-tool"
import { AssistantReasoning } from "../parts/text"
import { ToolDisplay } from "./display"
import { PatchTool } from "./file-tools"
import { contextToolTrigger, isFileChangeTool, readImagePath, samePatchFile, skillToolName, toolTitle } from "./info"
import { useSessionDirectory } from "./session"
import type { ContextGroupPart, ContextToolGroupProps, FileToolGroupProps } from "./types"

type Item = SessionMessageAssistantTool[] | Exclude<ContextGroupPart, SessionMessageAssistantTool>

const pending = (tool: SessionMessageAssistantTool) =>
  tool.state.status === "streaming" || tool.state.status === "running"

function namedSkill(tool: SessionMessageAssistantTool | undefined) {
  return (
    !!tool &&
    tool.name === "skill" &&
    tool.state.status !== "error" &&
    !!skillToolName(currentToolInput(tool), currentToolMetadata(tool))
  )
}

// Adjacent file changes and adjacent skills fold into one item.
function groupItems(parts: ContextGroupPart[]) {
  return parts.reduce<Item[]>((groups, part) => {
    if (part.type !== "tool") return [...groups, part]
    const previous = groups.at(-1)
    const first = Array.isArray(previous) ? previous[0] : undefined
    if (Array.isArray(previous) && first && isFileChangeTool(part) && isFileChangeTool(first))
      return [...groups.slice(0, -1), [...previous, part]]
    if (Array.isArray(previous) && namedSkill(part) && namedSkill(first))
      return [...groups.slice(0, -1), [...previous, part]]
    return [...groups, [part]]
  }, [])
}

function useLabel(parts: ContextGroupPart[]) {
  const i18n = useI18n()
  const names = [
    ...new Set(
      parts.flatMap((part) => {
        if (part.type === "shell") return [i18n.t("ui.tool.shell")]
        if (part.type !== "tool") return []
        if (part.name === "skill") return [i18n.t("ui.tool.skill")]
        if (part.name === "subagent") return [i18n.t("ui.tool.agent.default")]
        return [toolTitle(part.name, i18n, part.name === "websearch" ? currentToolMetadata(part) : undefined)]
      }),
    ),
  ].join(", ")
  const thoughts = parts.filter((part) => part.type === "reasoning").length
  if (!names && !thoughts) {
    const text =
      noticeGroupTitle(parts.map((part) => (part.type === "notice" ? part.title : undefined))) ??
      i18n.t("ui.messagePart.context.updates")
    return { text, title: "", before: text, count: "", between: "", after: "" }
  }
  const title = names || i18n.plural("ui.messagePart.context.thought", thoughts)
  const count = parts.filter((part) => part.type === "tool" || part.type === "shell").length || thoughts
  const text = i18n.plural("ui.messagePart.tools.used", count, { tools: title })
  const index = text.indexOf(title)
  const before = text.slice(0, index).trim()
  const countText = String(count)
  const countIndex = before.indexOf(countText)
  const after = text.slice(index + title.length).trim()
  if (countIndex === -1) return { text, title, before, count: "", between: "", after }
  return {
    text,
    title,
    before: before.slice(0, countIndex).trim(),
    count: countText,
    between: before.slice(countIndex + countText.length).trim(),
    after,
  }
}

export function ContextToolGroup(props: ContextToolGroupProps) {
  const i18n = useI18n()
  const directory = useSessionDirectory()
  const tools = props.parts.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
  const busy = props.busy || tools.some(pending)
  const label = useLabel(props.parts)
  const items = props.open ? groupItems(props.parts) : []
  const patchKeys = new Map<SessionMessageAssistantTool, string>(
    items.flatMap((item) => {
      if (!Array.isArray(item) || !item[0] || !isFileChangeTool(item[0])) return []
      const key = props.patchGroupKey?.(item) ?? item[0].id
      return item.map((tool) => [tool, key] as const)
    }),
  )
  const change = (open: boolean) => {
    props.onOpenChange(open)
    props.onSizeChange?.()
  }
  return (
    <div data-component="collapsed-tool-group" data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}>
      <BasicTool
        status={busy ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        open={props.open}
        onOpenChange={change}
        trigger={
          <div data-component="context-tool-group-trigger" aria-label={label.text}>
            <span data-slot="context-tool-group-title">
              {(label.before || label.count || label.between) && (
                <span data-slot="context-tool-group-usage">
                  {label.before && (
                    <span data-slot="context-tool-group-prefix">
                      {label.before}
                      {label.title ? " " : ""}
                    </span>
                  )}
                  {label.count && <span data-slot="context-tool-group-count">{label.count} </span>}
                  {label.between && <span data-slot="context-tool-group-prefix">{label.between} </span>}
                </span>
              )}
              {label.title && <span data-slot="basic-tool-tool-title">{label.title}</span>}
              {label.after && <span data-slot="context-tool-group-prefix">{label.after}</span>}
            </span>
          </div>
        }
      >
        <div data-component="context-tool-group-list" className="tool-group-list">
          {items.map((item, index) => {
            if (!Array.isArray(item)) {
              if (item.type === "reasoning")
                return (
                  <div key={item.id} data-slot="context-tool-group-item">
                    <AssistantReasoning
                      id={item.id}
                      content={item}
                      streaming={item.streaming ?? false}
                      defaultOpen={props.reasoningDefaultOpen}
                      open={props.reasoningOpen?.(item.id)}
                      onOpenChange={(open) => props.onReasoningOpenChange?.(item.id, open)}
                      onContentRendered={props.onSizeChange}
                    />
                  </div>
                )
              return (
                <div key={item.id} data-slot="context-tool-group-item">
                  {item.render()}
                </div>
              )
            }
            const tool = item[0]!
            const key = `${tool.id}:${index}`
            if (
              tool.state.status !== "error" &&
              ["read", "glob", "grep", "list"].includes(tool.name) &&
              !(tool.name === "read" && readImagePath(currentToolInput(tool))) &&
              !currentToolHasLoadedFiles(tool)
            ) {
              const trigger = contextToolTrigger(tool, i18n, directory)
              return (
                <div key={key} data-slot="context-tool-group-item">
                  <div data-component="tool-trigger" className="tool-context-row">
                    <div data-slot="basic-tool-tool-trigger-content">
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title">
                              <Shimmer text={trigger.title} active={pending(tool)} />
                            </span>
                            {trigger.subtitle && <span data-slot="basic-tool-tool-subtitle">{trigger.subtitle}</span>}
                            {trigger.args.map((arg) => (
                              <span key={arg} data-slot="basic-tool-tool-arg">
                                {arg}
                              </span>
                            ))}
                          </div>
                          {trigger.matches && (
                            <>
                              <span data-slot="context-tool-group-dot" className="tool-context-row__dot" />
                              <span data-slot="context-tool-group-matches">{trigger.matches}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
            const skills = item.flatMap((entry) => {
              const name = skillToolName(currentToolInput(entry), currentToolMetadata(entry))
              return name ? [name] : []
            })
            if (tool.name === "skill" && item.length > 1 && skills.length === item.length) {
              const marker = "__OPENCODE_LOADED_SKILL__"
              const loaded = i18n.plural("ui.tool.loadedSkills", skills.length, { name: marker }).split(marker)
              return (
                <div key={key} data-slot="context-tool-group-item">
                  <div
                    data-component="tool-loaded-item"
                    data-timeline-part-ids={item.map((entry) => entry.id).join(",")}
                    aria-label={i18n.plural("ui.tool.loadedSkills", skills.length, { name: skills.join(", ") })}
                    className="tool-loaded"
                  >
                    <span data-slot="tool-loaded-label" aria-hidden="true">
                      {loaded[0]?.trim()}
                    </span>
                    <span data-slot="tool-loaded-value" aria-hidden="true" className="tool-loaded__value">
                      {skills.map((name, position) => (
                        <span key={position}>
                          {position > 0 && ", "}
                          <Shimmer text={name} active={pending(item[position]!)} />
                        </span>
                      ))}
                    </span>
                    {loaded[1]?.trim() && (
                      <span data-slot="tool-loaded-kind" aria-hidden="true">
                        {loaded[1].trim()}
                      </span>
                    )}
                  </div>
                </div>
              )
            }
            if (isFileChangeTool(tool)) {
              const groupKey = patchKeys.get(tool)
              const fileOpen = props.fileOpen
              const onFileOpenChange = props.onFileOpenChange
              return (
                <div key={key} data-slot="context-tool-group-item">
                  <FileToolGroup
                    tools={item}
                    fileOpen={fileOpen && ((path) => fileOpen(`${groupKey}:${path}`))}
                    onFileOpenChange={onFileOpenChange && ((path, open) => onFileOpenChange(`${groupKey}:${path}`, open))}
                    onSizeChange={props.onSizeChange}
                  />
                </div>
              )
            }
            return (
              <div key={key} data-slot="context-tool-group-item">
                <ToolDisplay
                  id={tool.id}
                  tool={tool.name}
                  input={currentToolInput(tool)}
                  metadata={currentToolMetadata(tool)}
                  output={currentToolOutput(tool)}
                  error={currentToolError(tool)}
                  status={tool.state.status}
                  defaultOpen={props.toolDefaultOpen?.(tool) ?? false}
                  open={props.toolOpen?.(tool.id) ?? props.toolDefaultOpen?.(tool)}
                  onOpenChange={(open) => props.onToolOpenChange?.(tool.id, open)}
                  deferContent
                  virtualizeDiff={false}
                  onContentRendered={props.onSizeChange}
                />
              </div>
            )
          })}
        </div>
      </BasicTool>
    </div>
  )
}

type FileEntry = { key: string; toolID: string; value: unknown }

// The files a set of edit/write/patch calls changed; an entry keeps its identity while unchanged.
function fileEntries(tools: SessionMessageAssistantTool[]): FileEntry[] {
  return tools.flatMap((tool) => {
    const files = currentToolMetadata(tool).files
    if (Array.isArray(files) && files.length > 0)
      return files.map((value, index) => ({ key: `${tool.id}:${index}`, toolID: tool.id, value }))
    const input = currentToolInput(tool)
    if (typeof input.path !== "string") return []
    if (tool.name === "edit" && typeof input.oldString === "string" && typeof input.newString === "string") {
      const changes = diffLines(input.oldString, input.newString)
      const additions = changes.filter((item) => item.added).reduce((total, item) => total + (item.count ?? 0), 0)
      const deletions = changes.filter((item) => item.removed).reduce((total, item) => total + (item.count ?? 0), 0)
      if (additions === 0 && deletions === 0) return []
      return [
        {
          key: `${tool.id}:0`,
          toolID: tool.id,
          value: {
            file: input.path,
            patch: createTwoFilesPatch(input.path, input.path, input.oldString, input.newString),
            additions,
            deletions,
            status: "modified",
          },
        },
      ]
    }
    if (tool.name !== "write" || typeof input.content !== "string" || !input.content) return []
    return [
      {
        key: `${tool.id}:0`,
        toolID: tool.id,
        value: {
          file: input.path,
          patch: createTwoFilesPatch(input.path, input.path, "", input.content),
          additions: input.content.split("\n").length - Number(input.content.endsWith("\n")),
          deletions: 0,
          status: "modified",
        },
      },
    ]
  })
}

function mergeEntries(previous: FileEntry[], next: FileEntry[], tools: SessionMessageAssistantTool[]) {
  const updates = new Map(next.map((entry) => [entry.key, entry.value]))
  const existing = new Set(previous.map((entry) => entry.key))
  const owners = new Set(tools.map((tool) => tool.id))
  const result = [
    ...previous
      .filter((entry) => owners.has(entry.toolID))
      .map((entry) => {
        if (!updates.has(entry.key)) return entry
        const value = updates.get(entry.key)
        return samePatchFile(value, entry.value) ? entry : { ...entry, value }
      }),
    ...next.filter((entry) => !existing.has(entry.key)),
  ]
  return result.length === previous.length && result.every((entry, index) => entry === previous[index])
    ? previous
    : result
}

export function FileToolGroup(props: FileToolGroupProps) {
  const entries = useRef<FileEntry[]>([])
  const files = useRef<{ entries: FileEntry[]; metadata: Record<string, unknown> }>({ entries: [], metadata: { files: [] } })
  entries.current = mergeEntries(entries.current, fileEntries(props.tools), props.tools)
  if (files.current.entries !== entries.current)
    files.current = { entries: entries.current, metadata: { files: entries.current.map((entry) => entry.value) } }
  const name = props.tools[0]?.name
  return (
    <div
      data-component="tool-part-wrapper"
      data-timeline-part-id={props.tools.length === 1 ? props.tools[0]?.id : undefined}
      data-timeline-part-ids={props.tools.length > 1 ? props.tools.map((tool) => tool.id).join(",") : undefined}
    >
      <PatchTool
        tool={name === "edit" || name === "write" ? name : "patch"}
        input={{}}
        metadata={files.current.metadata}
        status={props.tools.some(pending) ? "running" : "completed"}
        fileOpen={props.fileOpen}
        onFileOpenChange={props.onFileOpenChange}
        deferContent
        virtualizeDiff={false}
        onContentRendered={props.onSizeChange}
      />
    </div>
  )
}
