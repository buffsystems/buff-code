// The composer card (#584), ported from the Solid editor (editor.tsx): the attachment strip, the
// contenteditable prompt the controller drives, and the toolbar — add menu, agent / model /
// variant, the "Steer / Queue" hint and send. React renders the frame; typing never re-renders it.

import { cx } from "@buff/ui/react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { isAttachment } from "@opencode/app/react-reuse/composer-prompt-parts"
import type { ContextItem } from "@opencode/app/react-reuse/composer-schema"
import { shallowEqual, useStore } from "../../../react/use-store"
import { useI18n } from "../../../i18n/provider"
import type { Attachments } from "../attachments/attachments"
import { uploads } from "../attachments/uploads"
import type { ComposerController, ComposerDelivery } from "../editor/controller"
import { promptText } from "../draft/draft"
import { AttachmentStrip } from "./attachments"
import { AddMenu, AlternateDelivery, ExitShell, SelectControl, SubmitButton, type SelectOption } from "./controls"
import { Suggestions } from "./suggestions"
import { openAttachment } from "./preview"
import { useDialog } from "../../../dialog/dialogs"
import { ScrollThumb } from "../../../react/scroll-thumb"
import "../composer.css"

export type ComposerKeys = {
  attach: string[]
  attachShortcut: string
  agent: string[]
  variant: string[]
  alternate: string[]
  exitShell: string[]
}

export type ComposerViewProps = {
  controller: ComposerController
  attachments?: Attachments
  placeholder: string
  /** Sending is possible at all (a connection, a model). */
  available: boolean
  working: boolean
  queue?: { alternate(): ComposerDelivery | undefined; editing(): string | undefined }
  agent?: { options: SelectOption[]; current: string; onSelect(id: string): void }
  variant: { options: SelectOption[]; current: string; onSelect(id: string): void }
  /** The model control and what sits beside it (Buff's permission mode). */
  modelControls?: ReactNode
  keys: ComposerKeys
  borderUnderlay?: boolean
  onStop(): void
  /** A context chip was removed or opened (the side panes follow). */
  onContextRemove?(item: ContextItem): void
  onContextOpen?(item: ContextItem): void
}

export function ComposerView(props: ComposerViewProps) {
  const i18n = useI18n()
  const dialog = useDialog()
  const controller = props.controller
  const draft = controller.draft
  const mode = useStore(controller.interaction, (state) => state.mode)
  const activeContextID = useStore(controller.interaction, (state) => state.activeContextID)
  const empty = useStore(draft.store, (state) => promptText(state.prompt) === "")
  const attachments = useStore(draft.store, (state) => state.prompt.filter(isAttachment), shallowEqual)
  const comments = useStore(draft.store, (state) => state.context.items.filter((item) => !!item.comment?.trim()), shallowEqual)
  const pendingIDs = useStore(props.attachments?.pending ?? noPending, (ids) => ids)
  const inFlight = useStore(uploads.store, (list) => list.filter((item) => pendingIDs.includes(item.id)), shallowEqual)
  const submittable = useStore(draft.store, () => controller.canSubmit())
  const canSubmit = submittable && props.available && inFlight.length === 0
  const stopping = props.working && empty && attachments.length === 0 && comments.length === 0
  const shell = mode === "shell"
  const editor = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = editor.current
    if (!element) return
    return controller.mount(element)
  }, [controller])
  useEffect(() => {
    controller.setViewport(viewport.current)
    return () => controller.setViewport(null)
  }, [controller])
  useEffect(() => props.attachments?.mount(), [props.attachments])

  const alternate = props.queue && canSubmit ? (props.queue.editing() ? "steer" : props.queue.alternate()) : undefined
  const fade = cx("composer__fade", shell && "composer__fade--hidden")

  return (
    <div className="relative flex size-full flex-col">
      <input
        type="file"
        multiple
        hidden
        data-slot="composer-file-input"
        onChange={(event) => {
          const list = event.currentTarget.files
          if (list) void props.attachments?.addAll(Array.from(list))
          event.currentTarget.value = ""
        }}
      />
      <Suggestions controller={controller} />
      <form
        data-component="composer"
        data-dock-border-underlay={props.borderUnderlay ? "true" : undefined}
        className={cx("composer group/composer", shell && "composer--shell")}
        onSubmit={(event) => {
          event.preventDefault()
          controller.submit()
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          controller.dispatch({ type: "drag.enter" })
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => controller.dispatch({ type: "drag.leave" })}
        onDrop={(event) => {
          event.preventDefault()
          controller.dispatch({ type: "drag.leave" })
          if (!props.attachments) return
          event.stopPropagation()
          void props.attachments.handleDrop(event.nativeEvent)
        }}
      >
        {!shell && (
          <AttachmentStrip
            attachments={attachments}
            uploads={inFlight}
            comments={comments}
            activeCommentID={activeContextID}
            onAttachmentClick={(attachment) => openAttachment(dialog, draft, attachment)}
            onAttachmentRemove={(attachment) => draft.removeAttachment(attachment.id)}
            onCommentClick={(comment) => {
              controller.dispatch({ type: "context.active", id: comment.key })
              props.onContextOpen?.(comment)
            }}
            onCommentRemove={(comment) => {
              props.onContextRemove?.(comment)
              draft.context.remove(comment.key)
            }}
          />
        )}
        <ComposerScroll viewport={viewport}>
          <div
            ref={editor}
            data-component="composer-editor"
            role="textbox"
            aria-multiline="true"
            aria-label={i18n.t("ui.promptInput.label")}
            dir={shell ? "ltr" : "auto"}
            contentEditable
            suppressContentEditableWarning
            autoCapitalize={shell ? "off" : "sentences"}
            autoCorrect={shell ? "off" : "on"}
            spellCheck={!shell}
            className="composer__editor"
            style={{ unicodeBidi: shell ? undefined : "plaintext" }}
          />
          {empty && (
            <div dir={shell ? "ltr" : "auto"} className="composer__placeholder" style={{ unicodeBidi: shell ? undefined : "plaintext" }}>
              {props.placeholder}
            </div>
          )}
        </ComposerScroll>
        <div className="composer__toolbar">
          <div className={cx("flex shrink-0 items-center", fade)} aria-hidden={shell} inert={shell}>
            <AddMenu
              disabled={shell}
              keys={props.keys.attach}
              attachShortcut={props.keys.attachShortcut}
              onAttach={() => props.attachments?.pick(() => fileInput(editor.current)?.click())}
              onCommands={() => controller.dispatch({ type: "commands.open" })}
              onContext={() => controller.dispatch({ type: "context.open" })}
              onShell={() => controller.dispatch({ type: "mode.shell" })}
            />
          </div>
          <Controls shell={shell} className={fade}>
            {props.agent && props.agent.options.length > 0 && (
              <SelectControl
                title={i18n.t("ui.promptInput.chooseAgent")}
                keys={props.keys.agent}
                options={props.agent.options}
                current={props.agent.current}
                onSelect={props.agent.onSelect}
              />
            )}
            {props.modelControls}
            {props.variant.options.length > 1 && (
              <SelectControl
                title={i18n.t("ui.promptInput.chooseVariant")}
                keys={props.keys.variant}
                options={props.variant.options}
                current={props.variant.current}
                className={props.variant.current === "default" ? "composer-variant-default" : undefined}
                onSelect={props.variant.onSelect}
              />
            )}
          </Controls>
          <div data-slot="composer-actions" className="composer__actions">
            {!shell && alternate && (
              <AlternateDelivery delivery={alternate} keys={props.keys.alternate} onSubmit={() => controller.submit({ alternate: true })} />
            )}
            {shell && (
              <ExitShell
                keys={props.keys.exitShell}
                onExit={() => {
                  controller.dispatch({ type: "mode.normal" })
                  controller.restoreFocus()
                }}
              />
            )}
            <SubmitButton mode={mode} stopping={stopping} disabled={!canSubmit} onSubmit={() => controller.submit()} onStop={props.onStop} />
          </div>
        </div>
      </form>
    </div>
  )
}

function fileInput(editor: HTMLElement | null) {
  return editor?.closest(".relative")?.querySelector<HTMLInputElement>('[data-slot="composer-file-input"]')
}

/** The scrolling row of selects, masked at the edge that hides more. */
function Controls(props: { shell: boolean; className: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })
  const update = () => {
    const element = viewport.current
    if (!element) return
    const offset = Math.abs(element.scrollLeft)
    const next = { start: offset > 1, end: element.scrollWidth - element.clientWidth - offset > 1 }
    setOverflow((current) => (current.start === next.start && current.end === next.end ? current : next))
  }
  useEffect(() => {
    const observer = new ResizeObserver(update)
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    update()
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={viewport}
      data-slot="composer-controls"
      data-overflow-start={overflow.start}
      data-overflow-end={overflow.end}
      className={cx("composer__controls", props.className)}
      onScroll={update}
      aria-hidden={props.shell}
      inert={props.shell}
    >
      <div ref={content} className="composer__controls-row">
        {props.children}
      </div>
    </div>
  )
}

// One empty list: a store's snapshot must be the same value until it changes.
const nothingPending: string[] = []
const noPending = { get: () => nothingPending, set: () => undefined, subscribe: () => () => undefined }

// The field's scroller: the native bar hidden, an overlay thumb while hovered. Its own component,
// so hovering never re-renders the composer.
function ComposerScroll(props: { viewport: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      data-component="composer-scroll"
      className="composer__scroll"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div ref={props.viewport} data-scrollable className="scroll-view__viewport composer__viewport" tabIndex={-1}>
        {props.children}
      </div>
      <ScrollThumb viewport={props.viewport} hovered={hovered} padding={8} />
    </div>
  )
}
