import { IconButton, Tooltip } from "@buff/ui/react"
import { getFilename } from "@opencode/util/path"
import { Check, ChevronRight, ChevronsUpDown, Copy, FileText, OctagonAlert } from "lucide-react"
import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import type { TranslationKey } from "../../../i18n/i18n"
import { useI18n } from "../../../i18n/provider"
import { useCopied, writeClipboard } from "../parts/text"
import { displayDirectory, type Diagnostic } from "./info"
import { useSessionDirectory } from "./session"

export function DiffChanges(props: { changes: { additions: number; deletions: number } }) {
  if (props.changes.additions + props.changes.deletions <= 0) return null
  return (
    <div data-component="diff-changes" data-appearance="standard" className="tool-diff-changes">
      <span data-slot="diff-changes-additions">{`+${props.changes.additions}`}</span>
      <span data-slot="diff-changes-deletions">{`-${props.changes.deletions}`}</span>
    </div>
  )
}

export function DiagnosticsDisplay(props: { diagnostics: Diagnostic[] }) {
  const i18n = useI18n()
  if (props.diagnostics.length === 0) return null
  return (
    <div data-component="diagnostics" className="tool-diagnostics">
      {props.diagnostics.map((diagnostic, index) => (
        <div key={index} data-slot="diagnostic">
          <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
          <span data-slot="diagnostic-location">
            [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
          </span>
          <span data-slot="diagnostic-message">{diagnostic.message}</span>
        </div>
      ))}
    </div>
  )
}

/** A command's console: the command, its output, and a copy button. */
export function ConsoleOutput(props: { copy: string; children: ReactNode; variant?: "shell" }) {
  const i18n = useI18n()
  const [copied, markCopied] = useCopied()
  const label = copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")
  return (
    <div data-component="bash-output" data-variant={props.variant} dir="ltr" className="tool-console ui-terminal">
      <div data-slot="bash-copy" className="tool-console__copy">
        <Tooltip content={label}>
          <IconButton
            icon={copied ? Check : Copy}
            size="xs"
            aria-label={label}
            onMouseDown={(event: MouseEvent) => event.preventDefault()}
            onClick={() => {
              if (!props.copy) return
              void writeClipboard(props.copy).then((done) => done && markCopied())
            }}
          />
        </Tooltip>
      </div>
      <div
        data-slot="bash-scroll"
        data-scrollable=""
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
        className="tool-console__scroll"
      >
        <pre data-slot="bash-pre" className="tool-console__pre">
          <code>{props.children}</code>
        </pre>
      </div>
    </div>
  )
}

/** The command beside a collapsed shell title; it slides in when it arrived while writing. */
export function ShellSubmessage(props: { text: string; animate?: boolean }) {
  const [shown, setShown] = useState(!props.animate)
  useEffect(() => {
    if (shown) return
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [shown])
  return (
    <span data-component="shell-submessage" dir="ltr" className="tool-submessage">
      <span data-slot="shell-submessage-width">
        <span data-slot="basic-tool-tool-subtitle">
          <span data-slot="shell-submessage-value" className={shown ? "tool-submessage--in" : "tool-submessage--out"}>
            {props.text}
          </span>
        </span>
      </span>
    </span>
  )
}

/** A group of file sections whose triggers move focus with the arrow keys. */
export function FileAccordionGroup(props: { children: ReactNode }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || target.dataset.slot !== "accordion-trigger") return
    if (target.closest('[data-component="accordion"]') !== event.currentTarget) return
    const triggers = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ':scope > [data-slot="accordion-item"] > [data-slot="accordion-header"] > [data-slot="accordion-trigger"]',
      ),
    ]
    const index = triggers.indexOf(target)
    if (index < 0) return
    event.preventDefault()
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? triggers.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + triggers.length) % triggers.length
    triggers[next]?.focus()
  }
  return (
    <div data-component="accordion" data-scope="apply-patch" className="tool-files" onKeyDown={onKeyDown}>
      {props.children}
    </div>
  )
}

export function FileAccordionItem(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type?: string
  header: ReactNode
  children: ReactNode
}) {
  const id = useId()
  const state = props.open ? { "data-expanded": "" } : { "data-closed": "" }
  return (
    <div data-slot="accordion-item" data-type={props.type} className="tool-files__item" {...state}>
      <h3 data-slot="accordion-header" data-component="sticky-accordion-header" className="tool-files__header" {...state}>
        <button
          type="button"
          id={`${id}-trigger`}
          data-slot="accordion-trigger"
          className="tool-files__trigger"
          aria-expanded={props.open}
          aria-controls={props.open ? `${id}-content` : undefined}
          onClick={() => props.onOpenChange(!props.open)}
          {...state}
        >
          {props.header}
        </button>
      </h3>
      {props.open && (
        <div
          id={`${id}-content`}
          role="region"
          aria-labelledby={`${id}-trigger`}
          data-slot="accordion-content"
          data-expanded=""
          className="tool-files__content"
        >
          {props.children}
        </div>
      )}
    </div>
  )
}

/** A file section's header: its icon, directory and name, then the actions on the right. */
export function FileHeader(props: { path: string; actions?: ReactNode }) {
  const directory = useSessionDirectory()
  return (
    <div data-slot="apply-patch-trigger-content" className="tool-files__header-content">
      <div data-slot="apply-patch-file-info" className="tool-files__info">
        <FileText aria-hidden className="tool-files__icon" />
        <div data-slot="apply-patch-file-name-container" className="tool-files__name">
          {props.path.includes("/") && (
            <span data-slot="apply-patch-directory" className="tool-files__directory">
              {`‪${displayDirectory(props.path, directory)}‬`}
            </span>
          )}
          <span data-slot="apply-patch-filename" className="tool-files__filename">
            {getFilename(props.path)}
          </span>
        </div>
      </div>
      <div data-slot="apply-patch-trigger-actions" className="tool-files__actions">
        {props.actions}
        <ChevronsUpDown aria-hidden className="tool-files__chevron" />
      </div>
    </div>
  )
}

/** Mount a section's body a frame after it opens, so the open itself paints at once. */
export function useVisibleAfterOpen(open: boolean) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!open) return setVisible(false)
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [open])
  return visible
}

/** One file of an edit or write call, folded into an accordion of its own. */
export function ToolFileAccordion(props: {
  path: string
  actions?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  defer?: boolean
}) {
  const [expanded, setExpanded] = useState(props.defaultOpen ?? false)
  const open = props.open ?? expanded
  const change = (value: boolean) => {
    if (props.open === undefined) setExpanded(value)
    props.onOpenChange?.(value)
  }
  useEffect(() => {
    if (props.forceOpen && !open) change(true)
  })
  const visible = useVisibleAfterOpen(open)
  return (
    <FileAccordionGroup>
      <FileAccordionItem open={open} onOpenChange={change} header={<FileHeader path={props.path} actions={props.actions} />}>
        {(!props.defer || visible) && props.children}
      </FileAccordionItem>
    </FileAccordionGroup>
  )
}

const errorTitles: Record<string, TranslationKey> = {
  read: "ui.tool.read",
  list: "ui.tool.list",
  glob: "ui.tool.glob",
  grep: "ui.tool.grep",
  subagent: "ui.tool.agent.default",
  webfetch: "ui.tool.webfetch",
  websearch: "ui.tool.websearch",
  shell: "ui.tool.shell",
  execute: "ui.tool.execute",
  patch: "ui.tool.patch",
  question: "ui.tool.questions",
}

/** A failed call: its summary on the title row, the detail and a copy button when opened. */
export function ToolErrorCard(props: {
  tool: string
  error: string
  title?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  subtitle?: string
  href?: string
  onSubtitleClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const i18n = useI18n()
  const [local, setLocal] = useState(props.defaultOpen ?? false)
  const [copied, markCopied] = useCopied()
  const open = props.open ?? local
  const setOpen = (value: boolean) => {
    if (props.open === undefined) setLocal(value)
    props.onOpenChange?.(value)
  }
  const key = errorTitles[props.tool]
  const name = props.title ?? (key ? i18n.t(key) : props.tool)
  const cleaned = props.error.replace(/^Error:\s*/, "").trim()
  const tail = cleaned.startsWith(`${props.tool} `) ? cleaned.slice(props.tool.length + 1) : cleaned
  const head = (tail.split(": ")[0] ?? "").trim()
  const summary = head ? head[0]!.toUpperCase() + head.slice(1) : i18n.t("ui.toolErrorCard.failed")
  const parts = tail.split(": ")
  const detail = parts.length <= 1 ? "" : parts.slice(1).join(": ").trim()
  const state = open ? { "data-expanded": "" } : { "data-closed": "" }
  const copyLabel = copied ? i18n.t("ui.message.copied") : i18n.t("ui.toolErrorCard.copyError")
  return (
    <div data-kind="tool-error-card" data-open={open ? "true" : "false"} className="tool-error">
      <div
        data-component="collapsible"
        className="tool-collapsible ui-collapsible"
        data-state={open ? "open" : "closed"}
        data-open={open ? "true" : "false"}
        {...state}
      >
        <button
          type="button"
          data-slot="collapsible-trigger"
          className="ui-collapsible__trigger"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          {...state}
        >
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <span data-slot="basic-tool-tool-indicator" data-component="tool-error-card-icon" className="tool-error__icon">
                <OctagonAlert aria-hidden />
              </span>
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{name}</span>
                    {props.subtitle &&
                      (props.href ? (
                        <a
                          data-slot="basic-tool-tool-subtitle"
                          className="clickable subagent-link"
                          href={props.href}
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onSubtitleClick?.(event)
                          }}
                        >
                          {props.subtitle}
                        </a>
                      ) : (
                        <span data-slot="basic-tool-tool-subtitle">{props.subtitle}</span>
                      ))}
                    <span data-slot="tool-error-card-summary">{summary}</span>
                  </div>
                </div>
              </div>
            </div>
            <div data-slot="collapsible-arrow">
              <ChevronRight aria-hidden className="ui-collapsible__chevron" />
            </div>
          </div>
        </button>
        {detail && open && (
          <div data-slot="collapsible-content" className="ui-collapsible__content" data-expanded="">
            <div data-slot="tool-error-card-content" className="tool-error__content">
              <div data-slot="tool-error-card-copy" className="tool-error__copy">
                <Tooltip content={copyLabel}>
                  <IconButton
                    icon={copied ? Check : Copy}
                    size="xs"
                    aria-label={copyLabel}
                    onMouseDown={(event: MouseEvent) => event.preventDefault()}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      void writeClipboard(cleaned).then((done) => done && markCopied())
                    }}
                  />
                </Tooltip>
              </div>
              <p className="tool-error__detail">{detail}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
