// What a tool call is called and shows (#584): the Solid tool renderer's pure helpers — titles,
// subtitles, paths, agents, diagnostics — taking the translator instead of reading a context.

import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { changedFileDiff } from "@opencode/session-ui/apply-patch-file"
import { currentToolInput, currentToolMetadata, executeToolFailed } from "@opencode/session-ui/current-tool-state"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffToolTitles } from "@opencode/schema/buff-tool-titles"
import { getDirectory, getFilename } from "@opencode/util/path"
import type { Translator } from "../../../i18n/i18n"
import type { ToolProps } from "./types"

export type Diagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  message: string
  severity?: number
}

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function questionInfo(value: unknown): value is { question: string } {
  return record(value) && typeof value.question === "string"
}

export function questionAnswer(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((answer) => typeof answer === "string")
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!record(value) || typeof value.message !== "string" || !record(value.range)) return false
  return record(value.range.start)
}

/** Up to three errors the language server reported for one file. */
export function getDiagnostics(diagnosticsByFile: unknown, filePath: string | undefined): Diagnostic[] {
  if (!record(diagnosticsByFile) || !filePath) return []
  const diagnostics = diagnosticsByFile[filePath]
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .filter(isDiagnostic)
    .filter((diagnostic) => diagnostic.severity === 1)
    .slice(0, 3)
}

export function relativizeProjectPath(path: string, directory?: string) {
  if (!path) return ""
  if (!directory || directory === "/" || directory === "\\") return path
  if (path === directory) return ""
  const separator = directory.includes("\\") ? "\\" : "/"
  const prefix = directory.endsWith(separator) ? directory : directory + separator
  if (!path.startsWith(prefix)) return path
  return path.slice(directory.length)
}

export function displayDirectory(path: string | undefined, directory: string | undefined) {
  return relativizeProjectPath(getDirectory(path), directory)
}

export function readToolPath(input: Record<string, unknown>) {
  return typeof input.path === "string" ? input.path : undefined
}

export function readImagePath(input: Record<string, unknown>) {
  const path = readToolPath(input)
  if (!path || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(path)) return
  return path.replaceAll("\\", "/")
}

export function skillToolName(input: Record<string, unknown>, metadata?: Record<string, unknown>) {
  if (typeof metadata?.name === "string") return metadata.name
  if (typeof input.id === "string") return input.id
  if (typeof input.name === "string") return input.name
  return undefined
}

export function webSearchProviderLabel(provider: unknown, i18n: Translator) {
  if (typeof provider !== "string" || !provider) return i18n.t("ui.tool.websearch")
  const name =
    provider === "tinyfish"
      ? "TinyFish"
      : provider === "opencode"
        ? "OpenCode"
        : `${provider[0]!.toUpperCase()}${provider.slice(1)}`
  return i18n.t("ui.tool.websearch.provider", { provider: name })
}

/** Buff (#470): Buff's own tools are named in words, not by their name for the model. */
export function buffToolTitle(tool: string, locale: string) {
  const title = BuffToolTitles.of(tool)
  return title ? BuffI18n.t(BuffI18n.locale(locale), title) : undefined
}

/** The title a tool goes by in a "Used N …" label. */
export function toolTitle(tool: string, i18n: Translator, metadata?: Record<string, unknown>) {
  const titles: Record<string, () => string> = {
    read: () => i18n.t("ui.tool.read"),
    list: () => i18n.t("ui.tool.list"),
    glob: () => i18n.t("ui.tool.glob"),
    grep: () => i18n.t("ui.tool.grep"),
    browser: () => i18n.t("ui.tool.browser"),
    webfetch: () => i18n.t("ui.tool.webfetch"),
    websearch: () => webSearchProviderLabel(metadata?.provider, i18n),
    subagent: () => i18n.t("ui.tool.agent.default"),
    shell: () => i18n.t("ui.tool.shell"),
    execute: () => i18n.t("ui.tool.execute"),
    edit: () => i18n.t("ui.messagePart.title.edit"),
    write: () => i18n.t("ui.messagePart.title.write"),
    patch: () => i18n.t("ui.tool.patch"),
    question: () => i18n.t("ui.tool.questions"),
    skill: () => i18n.t("ui.tool.skill"),
  }
  return titles[tool]?.() ?? buffToolTitle(tool, i18n.locale) ?? tool
}

export function urls(text: string | undefined) {
  if (!text) return []
  return [
    ...new Set([...text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((item) => item[0].replace(/[),.;:!?]+$/g, ""))),
  ]
}

const agentPalette = [
  "var(--primary)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "var(--syntax-func)",
  "var(--syntax-string)",
  "var(--syntax-keyword)",
  "var(--syntax-number)",
  "var(--syntax-var)",
]

const agentThemeColors: Record<string, string> = {
  primary: "var(--primary)",
  secondary: "var(--fg-2)",
  accent: "var(--accent-foreground)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--destructive)",
  info: "var(--primary)",
}

function tone(name: string) {
  const hash = [...name].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
  return agentPalette[hash % agentPalette.length]
}

/** A subagent's display name and colour, from the location's agents or a stable hash. */
export function taskAgent(raw: unknown, list?: readonly { name: string; color?: string }[]) {
  if (typeof raw !== "string" || !raw) return {}
  const key = raw.toLowerCase()
  const item = list?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  const color = item?.color ? (agentThemeColors[item.color] ?? item.color) : tone(key)
  return { name: item?.name ?? `${raw[0]!.toUpperCase()}${raw.slice(1)}`, color }
}

// Each branch must stay in sync with its tool trigger's subtitle expression so failed rows read
// like their non-error counterparts ("Shell sleep 30").
export function toolErrorSubtitle(props: ToolProps, i18n: Translator, directory: string | undefined) {
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)
  if (props.tool === "shell") return text(props.input.command) ?? text(props.metadata.command)
  if (props.tool === "execute") return text(props.input.code)
  if (props.tool === "read") return getFilename(readToolPath(props.input) ?? "")
  if (props.tool === "edit" || props.tool === "write") return getFilename(text(props.input.path) ?? "")
  if (props.tool === "list" || props.tool === "glob" || props.tool === "grep")
    return displayDirectory(text(props.input.path) ?? "/", directory)
  if (props.tool === "webfetch") return text(props.input.url)
  if (props.tool === "websearch") return text(props.input.query)
  if (props.tool === "skill") return skillToolName(props.input, props.metadata)
  if (props.tool === "patch") {
    const files = Array.isArray(props.metadata.files) ? props.metadata.files.filter(changedFileDiff) : []
    const count = new Set(files.map((file) => file.file)).size
    if (count === 0) return undefined
    return `${count} ${i18n.plural("ui.common.file", count)}`
  }
  if (props.tool === "question") {
    const count = Array.isArray(props.input.questions) ? props.input.questions.filter(questionInfo).length : 0
    if (count === 0) return undefined
    return `${count} ${i18n.plural("ui.common.question", count)}`
  }
  return undefined
}

export function toolDisplayError(props: ToolProps & { error?: string }, fallback: string) {
  if (props.status === "error") return props.error
  if (props.tool !== "execute" || !executeToolFailed(props.metadata)) return undefined
  if (typeof props.output === "string" && props.output) return props.output
  return fallback
}

export function isFileChangeTool(tool: SessionMessageAssistantTool) {
  return tool.state.status !== "error" && (tool.name === "edit" || tool.name === "write" || tool.name === "patch")
}

export function samePatchFile(a: unknown, b: unknown) {
  if (a === b) return true
  if (!record(a) || !record(b)) return false
  return (
    a.file === b.file &&
    a.patch === b.patch &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.status === b.status
  )
}

/** The one-line row of a read, list, glob or grep call inside a "Used" group. */
export function contextToolTrigger(tool: SessionMessageAssistantTool, i18n: Translator, directory?: string) {
  const input = currentToolInput(tool)
  const metadata = currentToolMetadata(tool)
  const path = typeof input.path === "string" ? input.path : "/"
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const count = tool.name === "glob" ? metadata.count : tool.name === "grep" ? metadata.matches : undefined
  const matches =
    typeof count === "number" && Number.isFinite(count) && count !== 0
      ? i18n.plural("ui.messagePart.context.match", count)
      : undefined
  if (tool.name === "read")
    return {
      title: i18n.t("ui.tool.read"),
      subtitle: getFilename(path),
      args: [
        ...(typeof input.offset === "number" ? [`offset=${input.offset}`] : []),
        ...(typeof input.limit === "number" ? [`limit=${input.limit}`] : []),
      ],
      matches: undefined,
    }
  if (tool.name === "list")
    return { title: i18n.t("ui.tool.list"), subtitle: displayDirectory(path, directory), args: [], matches: undefined }
  if (tool.name === "glob")
    return {
      title: i18n.t("ui.tool.glob"),
      subtitle: displayDirectory(path, directory),
      args: pattern ? [`pattern=${pattern}`] : [],
      matches,
    }
  return {
    title: i18n.t("ui.tool.grep"),
    subtitle: displayDirectory(path, directory),
    args: [...(pattern ? [`pattern=${pattern}`] : []), ...(include ? [`include=${include}`] : [])],
    matches,
  }
}
