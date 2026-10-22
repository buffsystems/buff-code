// The composer editor as an imperative controller (#584), ported from the Solid editor's
// interaction model (editor/interaction.ts) and its element handlers (editor/editor.tsx). React
// renders the frame once; this controller owns the contenteditable mounted through a ref — it
// renders the draft into it, reads typing back, drives the slash/@ suggestion machine, the prompt
// history and paste — so typing never goes through a React render.

import { chipPart } from "@opencode/app/react-reuse/attachment-prompt"
import { isAttachment, promptLength, clonePrompt } from "@opencode/app/react-reuse/composer-prompt-parts"
import {
  createComposerInteractionState,
  transitionComposer,
  type ComposerInteractionCommand,
  type ComposerInteractionEvent,
  type ComposerInteractionState,
} from "@opencode/app/react-reuse/composer-suggestions"
import type {
  ComposerHistoryEntry,
  ComposerPrompt,
  ComposerSuggestion,
} from "@opencode/app/react-reuse/composer-types"
import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import { createStore } from "../../../core/store"
import type { ComposerDraft } from "../draft/draft"
import { createFilteredList } from "../suggestions/filtered"
import { editorCursor, parseEditor, renderEditor, setTextCursor } from "./dom"
import { setCursorPosition } from "@opencode/app/react-reuse/composer-dom"

export type ComposerDelivery = "steer" | "queue"

/** The session's prompt queue as the composer sees it (see queue/queue.ts). */
export type ComposerQueue = {
  count(): number
  delivery(): ComposerDelivery
  alternate(): ComposerDelivery | undefined
  editing(): string | undefined
  confirmEdit(delivery: ComposerDelivery): void
  cancelEdit(): void
  editFirst(): boolean
}

export type ComposerHistory = {
  entries(mode: "normal" | "shell"): ComposerHistoryEntry[]
  add(prompt: ComposerPrompt, mode: "normal" | "shell"): void
  capture?(): unknown
  restore?(metadata: unknown): void
}

/** What the controller reads from the screen around it; read fresh on every use. */
export type ComposerControllerInput = {
  history?: ComposerHistory
  commands(): ComposerSuggestion[]
  context(): ComposerSuggestion[]
  searchContextFiles(query: string): ComposerSuggestion[] | Promise<ComposerSuggestion[]>
  onSuggestionSelect?(item: ComposerSuggestion): (() => void) | void
  /** Mod+U and the add menu: pick files. */
  attach(): void
  /** Files from a paste that are not text; true when they were taken. */
  pasteFiles?(event: ClipboardEvent): boolean
  submit: {
    available(): boolean
    working(): boolean
    queue?: ComposerQueue
    onSubmit(options?: { alternate?: boolean }): void
    onStop(): void
  }
  onModeChange?(mode: "normal" | "shell"): void
  /** Only writes the draft: no suggestions, no shell mode on "!" (a session being prepared). */
  draftOnly?: boolean
}

export type ComposerInteraction = ComposerInteractionState

export function createComposerController(draft: ComposerDraft, read: () => ComposerControllerInput) {
  const interaction = createStore<ComposerInteraction>({
    ...createComposerInteractionState(),
    mode: draft.mode(),
  })
  const state = () => interaction.get()
  const element: { editor?: HTMLElement; viewport?: HTMLElement } = {}
  // The prompt the editor itself produced: rendering it back would reset the caret.
  const local: { prompt?: ComposerPrompt } = {}

  const contextList = createFilteredList<ComposerSuggestion>({
    items: async (query) => {
      const context = read().context()
      const fixed = context.filter((item) => item.kind !== "file")
      const recent = context.filter((item) => item.kind === "file" && item.recent)
      if (!query.trim()) return [...fixed, ...recent]
      const seen = new Set(recent.map((item) => item.id))
      const files = (await read().searchContextFiles(query)).filter((item) => !seen.has(item.id))
      return [...fixed, ...recent, ...files]
    },
    filterKeys: ["label"],
    skipFilter: (item) => item.kind === "file" && !item.recent,
    groupBy: (item) => (item.kind === "file" ? (item.recent ? "recent" : "file") : item.kind),
    groupOrder: ["reference", "skill", "agent", "resource", "recent", "file"],
  })
  const commandList = createFilteredList<ComposerSuggestion>({
    items: () => read().commands(),
    filterKeys: ["trigger", "title"],
  })
  const list = () => (state().popover.type === "context" ? contextList : commandList)
  const suggestions = () => list().items()

  const focusAtDraftCursor = () =>
    requestAnimationFrame(() => {
      const editor = element.editor
      if (!editor) return
      editor.focus()
      // Buff (#470): after a menu item inserts "@", the caret goes where the draft remembers it.
      const cursor = draft.cursor()
      if (cursor !== undefined) setCursorPosition(editor, cursor)
    })

  const execute = (command: ComposerInteractionCommand) => {
    if (command.type === "draft.setText") return draft.setText(command.value)
    if (command.type === "draft.addText") return draft.addText(command.value)
    if (command.type === "mention.add") {
      if (command.item.mention) draft.addMention(command.item.mention, command.range)
      return
    }
    if (command.type === "popover.filter")
      return (command.popover === "command" ? commandList : contextList).filter(command.query)
    if (command.type === "suggestion.select") {
      const item = suggestions().find((entry) => entry.id === command.id)
      if (item) dispatch({ type: "popover.select", item })
      return
    }
    if (command.type === "focus.editor") focusAtDraftCursor()
  }

  function dispatch(event: ComposerInteractionEvent) {
    const before = state()
    const result = transitionComposer(before, event, draft.state())
    const select = event.type === "popover.select" ? event : undefined
    const action = select ? read().onSuggestionSelect?.(select.item) : undefined
    if (select && (!action || before.popover.type !== "command-menu")) result.commands.forEach(execute)
    if (select && action && select.item.kind === "command" && before.popover.type !== "command-menu")
      draft.setPrompt(draft.current().filter(isAttachment), 0)
    interaction.set(() => settled(before, result.state))
    if (before.mode !== result.state.mode) {
      draft.setMode(result.state.mode)
      read().onModeChange?.(result.state.mode)
    }
    if (!select) result.commands.forEach(execute)
    action?.()
    return result.handled
  }

  // A popover follows its results: the active row stays while it is listed, else the first.
  const syncResults = () => {
    const popover = state().popover
    if (popover.type === "closed") return
    const ids = suggestions().map((item) => item.id)
    const active = popover.activeID
    if (active ? ids.includes(active) : ids.length === 0) return
    dispatch({ type: "popover.results", ids })
  }

  const restoreFocus = (cursor = draft.cursor() ?? promptLength(draft.current())) =>
    requestAnimationFrame(() => {
      if (!element.editor) return
      element.editor.focus()
      setTextCursor(element.editor, cursor)
    })

  const applyHistory = (entry: ComposerHistoryEntry, position: "start" | "end") => {
    read().history?.restore?.(entry.metadata)
    const cursor = position === "start" ? 0 : promptLength(entry.prompt)
    draft.setPrompt(clonePrompt(entry.prompt), cursor)
    restoreFocus(cursor)
  }
  const navigateHistory = (direction: "up" | "down") => {
    const history = read().history
    const editor = element.editor
    if (!history || !editor) return false
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false
    const text = draft.current().map((part) => ("content" in part ? part.content : "")).join("")
    const index = state().historyIndex
    if (!canNavigateHistory(direction, text, editorCursor(editor), index >= 0)) return false
    const entries = history.entries(state().mode)
    if (direction === "up") {
      if (entries.length === 0 || index >= entries.length - 1) return false
      const savedHistory =
        index === -1 ? { prompt: clonePrompt(draft.current()), metadata: history.capture?.() } : state().savedHistory
      interaction.set((current) => ({ ...current, historyIndex: index + 1, savedHistory }))
      const entry = entries[index + 1]
      if (entry) applyHistory(entry, "start")
      return true
    }
    if (index < 0) return false
    if (index > 0) {
      interaction.set((current) => ({ ...current, historyIndex: index - 1 }))
      const entry = entries[index - 1]
      if (entry) applyHistory(entry, "end")
      return true
    }
    const saved = state().savedHistory ?? { prompt: [{ type: "text" as const, content: "", start: 0, end: 0 }] }
    resetHistory()
    applyHistory(saved, "end")
    return true
  }
  const resetHistory = () => interaction.set((current) => ({ ...current, historyIndex: -1, savedHistory: undefined }))

  const canSubmit = () => {
    const input = read()
    if (!input.submit.available()) return false
    const persisted = draft.state()
    if (state().mode === "shell") return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
    if (persisted.prompt.some(isAttachment)) return true
    if (persisted.context.items.some((item) => !!item.comment?.trim())) return true
    return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
  }
  const submit = (options?: { alternate?: boolean }) => {
    const input = read()
    if (!input.submit.available()) return
    input.submit.onSubmit(options)
    dispatch({ type: "popover.close" })
  }

  const onPopoverKey = (event: KeyboardEvent) => {
    const empty = draft.current().every((part) => !("content" in part) || part.content.length === 0)
    const handled = dispatch({
      type: "key.down",
      key: event.key,
      ctrl: event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
      composing: event.isComposing,
      ids: suggestions().map((item) => item.id),
      empty,
    })
    if (!handled) return false
    event.preventDefault()
    const popover = state().popover
    if (event.key !== "Enter" && event.key !== "Tab" && popover.type !== "closed") {
      const id = popover.activeID ?? ""
      requestAnimationFrame(() =>
        document.querySelector(`[data-suggestion-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }),
      )
    }
    return true
  }

  // The editor's and the command search's key handling (interaction.ts onKeyDown).
  const onKeyDown = (event: KeyboardEvent) => {
    const input = read()
    const mod = event.metaKey || event.ctrlKey
    if (state().mode === "normal" && mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      input.attach()
      return true
    }
    if (onPopoverKey(event)) return true
    if (event.key === "Escape" && input.submit.queue?.editing()) {
      event.preventDefault()
      input.submit.queue.cancelEdit()
      return true
    }
    const ctrlG = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "g"
    if (input.submit.working() && (ctrlG || event.key === "Escape")) {
      event.preventDefault()
      input.submit.onStop()
      return true
    }
    const plainArrow = !event.altKey && !event.ctrlKey && !event.metaKey
    if (plainArrow && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (navigateHistory(event.key === "ArrowUp" ? "up" : "down")) {
        event.preventDefault()
        return true
      }
    }
    return event.defaultPrevented
  }

  // The editor element's own keydown (editor.tsx): the above, then queue recall and Enter.
  const onEditorKeyDown = (event: KeyboardEvent) => {
    if (onKeyDown(event)) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === "ArrowUp" && !event.shiftKey && !event.altKey) {
      if (read().submit.queue?.editFirst()) event.preventDefault()
      return
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
    event.preventDefault()
    if (event.repeat) return
    submit(mod ? { alternate: true } : undefined)
  }

  const onInput = () => {
    const editor = element.editor
    if (!editor) return
    const cursor = editorCursor(editor)
    const prompt = [...parseEditor(editor), ...draft.current().filter(isAttachment)]
    local.prompt = prompt
    draft.setPrompt(prompt, cursor)
    if (read().draftOnly) return
    dispatch({ type: "input.changed", value: prompt.map((part) => ("content" in part ? part.content : "")).join(""), persist: false })
  }

  const updateCursor = () => {
    const editor = element.editor
    if (!editor || !window.getSelection()?.isCollapsed) return
    draft.setCursor(editorCursor(editor))
  }

  const onPaste = (event: ClipboardEvent) => {
    const editor = element.editor
    const clipboard = event.clipboardData
    if (read().pasteFiles?.(event)) return
    const text = clipboard?.getData("text/plain")
    if (!text) return
    event.preventDefault()
    const normalized = text.replace(/\r\n?/g, "\n")
    // Buff (#459): a large paste becomes a chip beside the field; the model still gets all of it.
    if (draft.mode() !== "shell" && BuffComposerParts.isLargePaste(normalized)) {
      draft.setPrompt([...draft.current(), chipPart("paste", normalized, crypto.randomUUID())], draft.cursor())
      return
    }
    // insertText emits input per line, re-parsing the draft each time; escaped HTML inserts
    // multiline text once and keeps native selection and undo.
    const multiline = normalized.includes("\n")
    const value = multiline
      ? normalized.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      : normalized
    const inserted =
      typeof document.execCommand === "function" && document.execCommand(multiline ? "insertHTML" : "insertText", false, value)
    if (!inserted) insertFallback(editor, normalized)
    revealCaret()
  }

  // Programmatic multiline insertion does not reliably scroll the caret into view.
  const revealCaret = () =>
    requestAnimationFrame(() => {
      const selection = window.getSelection()
      const { editor, viewport } = element
      if (!editor || !viewport || !selection?.isCollapsed || !selection.rangeCount) return
      if (!editor.contains(selection.anchorNode)) return
      const caret = selection.getRangeAt(0).getBoundingClientRect()
      if (!caret.height) return
      const bounds = viewport.getBoundingClientRect()
      if (caret.bottom > bounds.bottom - 8) viewport.scrollTop += caret.bottom - bounds.bottom + 8
      if (caret.top < bounds.top + 8) viewport.scrollTop += caret.top - bounds.top - 8
    })

  const render = () => {
    const editor = element.editor
    if (!editor) return
    const prompt = draft.current()
    if (prompt === local.prompt) return
    local.prompt = prompt
    renderEditor(editor, prompt)
  }
  const followDraft = () => {
    render()
    // External draft changes (a queue edit, a restored send) bring their mode along.
    const mode = draft.mode()
    if (mode !== state().mode)
      interaction.set((current) => (mode === "shell" ? { ...current, mode, popover: { type: "closed" } } : { ...current, mode }))
  }
  // The controller follows its draft and suggestion lists while connected: from creation, and again
  // after an effect cleanup (React's strict mode runs one on mount) through `connect`.
  const subscribe = () => {
    const stops = [
      draft.store.subscribe(followDraft),
      contextList.store.subscribe(syncResults),
      commandList.store.subscribe(syncResults),
    ]
    return () => stops.forEach((stop) => stop())
  }
  const connection: { stop?: () => void } = { stop: subscribe() }
  const disconnect = () => {
    connection.stop?.()
    connection.stop = undefined
  }
  void draft.ready.then(() => {
    const mode = draft.mode()
    if (mode !== state().mode) interaction.set((current) => ({ ...current, mode }))
  })

  return {
    interaction,
    draft,
    suggestions,
    lists: { context: contextList, command: commandList },
    dispatch,
    onKeyDown,
    canSubmit,
    submit,
    restoreFocus,
    resetHistory,
    editor: () => element.editor,
    addHistory(prompt: ComposerPrompt, mode: "normal" | "shell") {
      read().history?.add(prompt, mode)
      resetHistory()
    },
    setQuery: (value: string) => dispatch({ type: "popover.query", value }),
    setViewport(viewport: HTMLElement | null) {
      element.viewport = viewport ?? undefined
    },
    /** Mount the contenteditable; returns the unmount. */
    mount(editor: HTMLElement) {
      element.editor = editor
      local.prompt = undefined
      render()
      const keydown = (event: KeyboardEvent) => onEditorKeyDown(event)
      const focus = () => dispatch({ type: "focus.editor" })
      editor.addEventListener("input", onInput)
      editor.addEventListener("keydown", keydown)
      editor.addEventListener("keyup", updateCursor)
      editor.addEventListener("pointerup", updateCursor)
      editor.addEventListener("paste", onPaste)
      editor.addEventListener("focus", focus)
      return () => {
        editor.removeEventListener("input", onInput)
        editor.removeEventListener("keydown", keydown)
        editor.removeEventListener("keyup", updateCursor)
        editor.removeEventListener("pointerup", updateCursor)
        editor.removeEventListener("paste", onPaste)
        editor.removeEventListener("focus", focus)
        if (element.editor === editor) element.editor = undefined
      }
    },
    /** Follow the draft (again); returns the disconnect, for an effect's cleanup. */
    connect() {
      if (!connection.stop) {
        connection.stop = subscribe()
        followDraft()
      }
      return disconnect
    },
    dispose: disconnect,
  }
}

export type ComposerController = ReturnType<typeof createComposerController>

// Transitions build fresh objects; keeping the unchanged parts lets subscribers skip a render.
function settled(before: ComposerInteraction, next: ComposerInteraction): ComposerInteraction {
  const popover = JSON.stringify(before.popover) === JSON.stringify(next.popover) ? before.popover : next.popover
  const value = { ...next, popover }
  const same = (Object.keys(value) as (keyof ComposerInteraction)[]).every((key) => value[key] === before[key])
  return same && Object.keys(before).length === Object.keys(value).length ? before : value
}

export function canNavigateHistory(direction: "up" | "down", text: string, cursor: number, inHistory: boolean) {
  const position = Math.max(0, Math.min(cursor, text.length))
  if (inHistory) return position === 0 || position === text.length
  if (direction === "up") return position === 0 && text.length === 0
  return position === text.length
}

function insertFallback(editor: HTMLElement | undefined, text: string) {
  const selection = window.getSelection()
  if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }))
}
