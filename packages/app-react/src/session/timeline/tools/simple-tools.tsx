// The read-only tools (#584): read, list, glob, grep, web fetch and search, questions, skills,
// Buff's to-do and plan cards, and the generic "Called `tool`" row for everything else.

import { Button } from "@buff/ui/react"
import { BuffPlan } from "@opencode/schema/buff-plan"
import { BuffQuestion } from "@opencode/schema/buff-question"
import { BuffTodo } from "@opencode/schema/buff-todo"
import { getFilename } from "@opencode/util/path"
import { Check, Circle, CircleDot, SquareArrowOutUpRight } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { createMarkdownImages } from "../markdown/images"
import { previewImages, usePreviewImage, useReadImage } from "../markdown/image-preview"
import { useI18n } from "../../../i18n/provider"
import { Markdown } from "../markdown/markdown"
import { BasicTool, Shimmer } from "../parts/basic-tool"
import { writeClipboard } from "../parts/text"
import {
  displayDirectory,
  questionAnswer,
  questionInfo,
  readImagePath,
  readToolPath,
  relativizeProjectPath,
  skillToolName,
  urls,
  webSearchProviderLabel,
} from "./info"
import { useSessionDirectory } from "./session"
import type { ToolProps } from "./types"

function passThrough(props: ToolProps) {
  return {
    status: props.status,
    hideDetails: props.hideDetails,
    defaultOpen: props.defaultOpen,
    open: props.open,
    onOpenChange: props.onOpenChange,
    forceOpen: props.forceOpen,
    locked: props.locked,
  }
}

function label(input: Record<string, unknown>) {
  const keys = ["description", "query", "url", "path", "pattern", "name"]
  return keys.map((key) => input[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

function args(input: Record<string, unknown>) {
  const skip = new Set(["description", "query", "url", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [`${key}=${value}`] : [],
    )
    .slice(0, 3)
}

export function GenericTool(props: ToolProps) {
  const i18n = useI18n()
  return (
    <BasicTool
      status={props.status}
      hideDetails={props.hideDetails}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
    />
  )
}

function ToolOutput(props: { output: string }) {
  const i18n = useI18n()
  return (
    <div
      data-component="tool-output"
      data-scrollable=""
      tabIndex={0}
      role="region"
      aria-label={i18n.t("ui.scrollView.ariaLabel")}
      className="tool-output"
    >
      <Markdown text={props.output} />
    </div>
  )
}

export function ReadTool(props: ToolProps) {
  const i18n = useI18n()
  const directory = useSessionDirectory()
  const image = props.status === "completed" ? readImagePath(props.input) : undefined
  const loaded =
    props.status === "completed" && Array.isArray(props.metadata.loaded)
      ? props.metadata.loaded.filter((path): path is string => typeof path === "string")
      : []
  const paths = loaded.map((path) => {
    const relative = relativizeProjectPath(path, directory)
    return relative === path ? relative : relative.replace(/^[/\\]/, "")
  })
  const marker = "__OPENCODE_LOADED_PATH__"
  const parts = i18n.t("ui.tool.loadedFile", { path: marker }).split(marker)
  return (
    <>
      <BasicTool
        {...passThrough(props)}
        hasContent={!!image}
        defer
        onOpenChange={(open) => {
          props.onOpenChange?.(open)
          props.onContentRendered?.()
        }}
        trigger={{
          title: i18n.t("ui.tool.read"),
          subtitle: getFilename(readToolPath(props.input) ?? ""),
          args: [
            ...(typeof props.input.offset === "number" ? [`offset=${props.input.offset}`] : []),
            ...(typeof props.input.limit === "number" ? [`limit=${props.input.limit}`] : []),
          ],
        }}
      >
        {image && <ReadImage key={image} path={image} onContentRendered={props.onContentRendered} />}
      </BasicTool>
      {paths.length > 0 && (
        <div
          data-component="tool-loaded-item"
          aria-label={i18n.t("ui.tool.loadedFile", { path: paths.join(", ") })}
          className="tool-loaded"
        >
          <span data-slot="tool-loaded-label" aria-hidden="true">
            {parts[0]?.trim()}
          </span>
          <span data-slot="tool-loaded-value" aria-hidden="true" className="tool-loaded__value">
            {paths.join(", ")}
          </span>
          {parts[1]?.trim() && (
            <span data-slot="tool-loaded-kind" aria-hidden="true">
              {parts[1].trim()}
            </span>
          )}
        </div>
      )}
    </>
  )
}

// A local image path is not a browser URL: the server reads it, and a click opens it large.
function ReadImage(props: { path: string; onContentRendered?: () => void }) {
  const i18n = useI18n()
  const readImage = useReadImage()
  const preview = usePreviewImage()
  const root = useRef<HTMLDivElement>(null)
  const rendered = useRef(props.onContentRendered)
  rendered.current = props.onContentRendered
  useEffect(() => rendered.current?.(), [])
  useEffect(() => {
    const element = root.current
    if (!element) return
    previewImages(element, preview, i18n.t("ui.imagePreview.alt"))
    if (!readImage) return
    const images = createMarkdownImages(readImage)
    images.update(element)
    return () => images.dispose()
  }, [props.path, readImage, preview, i18n])
  return (
    <div ref={root} data-component="read-image" className="tool-image">
      <img
        data-local-image={props.path}
        alt={getFilename(props.path)}
        onLoad={() => props.onContentRendered?.()}
        onError={() => props.onContentRendered?.()}
      />
    </div>
  )
}

function DirectoryTool(props: ToolProps & { title: string; args: string[] }) {
  const directory = useSessionDirectory()
  return (
    <BasicTool
      {...passThrough(props)}
      hasContent={!!props.output}
      trigger={{
        title: props.title,
        subtitle: displayDirectory(typeof props.input.path === "string" ? props.input.path : "/", directory),
        args: props.args,
      }}
    >
      {props.output && <ToolOutput output={props.output} />}
    </BasicTool>
  )
}

export function ListTool(props: ToolProps) {
  const i18n = useI18n()
  return <DirectoryTool {...props} title={i18n.t("ui.tool.list")} args={[]} />
}

export function GlobTool(props: ToolProps) {
  const i18n = useI18n()
  return (
    <DirectoryTool
      {...props}
      title={i18n.t("ui.tool.glob")}
      args={typeof props.input.pattern === "string" ? [`pattern=${props.input.pattern}`] : []}
    />
  )
}

export function GrepTool(props: ToolProps) {
  const i18n = useI18n()
  return (
    <DirectoryTool
      {...props}
      title={i18n.t("ui.tool.grep")}
      args={[
        ...(typeof props.input.pattern === "string" ? [`pattern=${props.input.pattern}`] : []),
        ...(typeof props.input.include === "string" ? [`include=${props.input.include}`] : []),
      ]}
    />
  )
}

export function WebfetchTool(props: ToolProps) {
  const i18n = useI18n()
  const pending = props.status === "streaming" || props.status === "running"
  const url = typeof props.input.url === "string" ? props.input.url : ""
  return (
    <BasicTool
      {...passThrough(props)}
      hideDetails
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <Shimmer text={i18n.t("ui.tool.webfetch")} active={pending} />
            </span>
            {!pending && url && (
              <a
                data-slot="basic-tool-tool-subtitle"
                className="webfetch-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <span data-slot="webfetch-link-text">{url}</span>
                <SquareArrowOutUpRight aria-hidden className="webfetch-link-icon" />
              </a>
            )}
          </div>
        </div>
      }
    />
  )
}

function ExaOutput(props: { output?: string }) {
  const i18n = useI18n()
  const [all, setAll] = useState(false)
  const revealed = useRef<HTMLAnchorElement | null>(null)
  const links = urls(props.output)
  if (links.length === 0) return null
  const visible = all || links.length <= 10 ? links : links.slice(0, 10)
  const remaining = Math.max(0, links.length - 10)
  const expand = (event: MouseEvent) => {
    event.stopPropagation()
    setAll(true)
    requestAnimationFrame(() => revealed.current?.focus())
  }
  return (
    <div data-component="exa-tool-output" className="tool-links">
      <div data-slot="exa-tool-links">
        {visible.map((url, index) => (
          <a
            key={url}
            ref={index === 10 ? revealed : undefined}
            data-slot="exa-tool-link"
            className="webfetch-link"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            <span data-slot="webfetch-link-text">{url}</span>
            <SquareArrowOutUpRight aria-hidden className="webfetch-link-icon" />
          </a>
        ))}
        {!all && remaining > 0 && (
          <button type="button" data-slot="exa-tool-more" className="tool-links__more" onClick={expand}>
            {i18n.plural("ui.common.moreCount", remaining)}
          </button>
        )}
      </div>
    </div>
  )
}

export function WebsearchTool(props: ToolProps) {
  const i18n = useI18n()
  return (
    <BasicTool
      {...passThrough(props)}
      trigger={{
        title: webSearchProviderLabel(props.metadata.provider, i18n),
        subtitle: typeof props.input.query === "string" ? props.input.query : "",
      }}
    >
      <ExaOutput output={props.output} />
    </BasicTool>
  )
}

export function QuestionTool(props: ToolProps) {
  const i18n = useI18n()
  const questions = Array.isArray(props.input.questions) ? props.input.questions.filter(questionInfo) : []
  const answers = Array.isArray(props.metadata.answers) ? props.metadata.answers.filter(questionAnswer) : []
  const completed = answers.length > 0
  const count = questions.length
  const subtitle =
    count === 0
      ? ""
      : completed
        ? i18n.t("ui.question.subtitle.answered", { count })
        : `${count} ${i18n.plural("ui.common.question", count)}`
  return (
    <BasicTool
      {...passThrough(props)}
      defaultOpen={completed}
      trigger={{ title: i18n.t("ui.tool.questions"), subtitle }}
    >
      {completed && (
        <div data-component="question-answers" className="tool-answers">
          {questions.map((question, index) => (
            <div key={index} data-slot="question-answer-item">
              <div data-slot="question-text" className="tool-answers__question">
                {question.question}
              </div>
              <div data-slot="answer-text">
                {(answers[index] ?? []).map((item) => BuffQuestion.optionLabel(item, i18n.buff.t)).join(", ") ||
                  i18n.t("ui.question.answer.none")}
              </div>
            </div>
          ))}
        </div>
      )}
    </BasicTool>
  )
}

export function SkillTool(props: ToolProps) {
  const i18n = useI18n()
  const name = skillToolName(props.input, props.metadata)
  const running = props.status === "streaming" || props.status === "running"
  if (!name) return <Shimmer text={i18n.t("ui.tool.skill")} active={running} />
  const marker = "__OPENCODE_LOADED_SKILL__"
  const parts = i18n.t("ui.tool.loadedSkill", { name: marker }).split(marker)
  return (
    <div
      data-component="tool-loaded-item"
      aria-label={i18n.t("ui.tool.loadedSkill", { name })}
      className="tool-loaded"
    >
      <span data-slot="tool-loaded-label" aria-hidden="true">
        {parts[0]?.trim()}
      </span>
      <span data-slot="tool-loaded-value" aria-hidden="true" className="tool-loaded__value">
        <Shimmer text={name} active={running} />
      </span>
      {parts[1]?.trim() && (
        <span data-slot="tool-loaded-kind" aria-hidden="true">
          {parts[1].trim()}
        </span>
      )}
    </div>
  )
}

const todoIcon = { completed: Check, in_progress: CircleDot, pending: Circle } as const
const todoStatus = { completed: "done", in_progress: "in progress", pending: "waiting" } as const

/** Buff (#463): the to-do list — done, in progress or waiting. */
export function TodoList(props: { items: readonly BuffTodo.Item[] }) {
  const i18n = useI18n()
  return (
    <ul data-component="buff-todo-list" className="tool-todos">
      {props.items.map((item, index) => {
        const Icon = todoIcon[item.status]
        return (
          <li key={index} data-status={item.status}>
            <Icon role="img" aria-label={i18n.buff.t(todoStatus[item.status])} className="tool-todos__icon" />
            <span>{item.content}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function TodoTool(props: ToolProps) {
  const i18n = useI18n()
  const items = BuffTodo.fromInput(props.input) ?? []
  const state = BuffTodo.progress(items)
  return (
    <BasicTool
      {...passThrough(props)}
      hasContent={items.length > 0}
      trigger={{
        title: i18n.buff.t("To-dos"),
        subtitle: `${state.done}/${state.total}${state.current ? ` · ${state.current}` : ""}`,
      }}
    >
      <TodoList items={items} />
    </BasicTool>
  )
}

/** Buff (#463): the agent's plan from Plan mode — folded, "Show in full", "Copy" and its state. */
export function PlanTool(props: ToolProps) {
  const i18n = useI18n()
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const plan = typeof props.input.plan === "string" ? props.input.plan : ""
  return (
    <BasicTool
      {...passThrough(props)}
      defaultOpen
      hasContent={!!plan}
      trigger={{
        title: i18n.buff.t("Plan"),
        subtitle: BuffPlan.state(BuffPlan.decisionOf(props.metadata), props.status ?? "", i18n.buff.t),
      }}
    >
      <div data-component="buff-plan" data-full={full} className="tool-plan">
        <div data-slot="buff-plan-text" className="tool-plan__text">
          <Markdown text={plan} />
        </div>
        <div data-slot="buff-plan-actions" className="tool-plan__actions">
          <Button size="sm" variant="ghost" data-action="buff-plan-full" onClick={() => setFull(!full)}>
            {full ? i18n.buff.t("Collapse") : i18n.buff.t("Show in full")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-action="buff-plan-copy"
            onClick={() => void writeClipboard(plan).then(() => setCopied(true))}
          >
            {copied ? i18n.buff.t("Copied") : i18n.buff.t("Copy")}
          </Button>
        </div>
      </div>
    </BasicTool>
  )
}
