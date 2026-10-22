// The composer's contenteditable as a prompt (#584): rendering prompt parts into the element and
// reading them back, ported unchanged from the Solid editor (editor.tsx). Mentions are
// non-editable spans that remember their full part; text is plain text nodes.

import type { ComposerAttachment, ComposerPrompt } from "@opencode/app/react-reuse/composer-types"
import { isAttachment } from "@opencode/app/react-reuse/composer-prompt-parts"
import { Skill } from "@opencode/schema/skill"

type MentionPart = Exclude<ComposerPrompt[number], ComposerAttachment | { type: "text" }>

const mentionParts = new WeakMap<HTMLElement, MentionPart>()

/** Replace the element's content with the prompt; a focused editor keeps its caret at the end. */
export function renderEditor(editor: HTMLElement, prompt: ComposerPrompt) {
  const active = document.activeElement === editor
  editor.replaceChildren(
    ...prompt.flatMap<Node>((part) => {
      if (isAttachment(part)) return []
      if (part.type === "text") return [document.createTextNode(part.content)]
      const mention = document.createElement("span")
      mentionParts.set(mention, part)
      mention.textContent = part.content
      mention.contentEditable = "false"
      mention.dir = "auto"
      mention.style.unicodeBidi = "isolate"
      mention.dataset.mention = part.type === "file" && part.mime === "application/x-directory" ? "reference" : part.type
      if (part.type === "agent") mention.dataset.name = part.name
      if (part.type === "skill") {
        mention.dataset.id = part.id
        mention.dataset.name = part.name
      }
      if (part.type === "file") {
        mention.dataset.path = part.path
        if (part.mime) mention.dataset.mime = part.mime
        if (part.filename) mention.dataset.filename = part.filename
      }
      return [mention]
    }),
  )
  if (!active) return
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** The prompt the element shows (without attachments, which live beside the text). */
export function parseEditor(editor: HTMLElement): ComposerPrompt {
  const parts: ComposerPrompt = []
  const state = { buffer: "", position: 0 }
  const flush = () => {
    if (!state.buffer) return
    parts.push({
      type: "text",
      content: state.buffer,
      start: state.position,
      end: state.position + state.buffer.length,
    })
    state.position += state.buffer.length
    state.buffer = ""
  }
  const push = (part: MentionPart) => {
    parts.push(part)
    state.position += part.content.length
  }
  const mention = (element: HTMLElement) => {
    flush()
    const content = element.textContent ?? ""
    const original = mentionParts.get(element)
    const at = { content, start: state.position, end: state.position + content.length }
    if (element.dataset.mention === "agent")
      return push({
        ...(original?.type === "agent" ? original : {}),
        type: "agent",
        name: element.dataset.name ?? content.slice(1),
        ...at,
      })
    if (element.dataset.mention === "skill")
      return push({
        ...(original?.type === "skill" ? original : {}),
        type: "skill",
        id: Skill.ID.make(element.dataset.id ?? content.slice(1)),
        name: Skill.Name.make(element.dataset.name ?? content.slice(1)),
        ...at,
      })
    push({
      ...(original?.type === "file" ? original : {}),
      type: "file",
      path: element.dataset.path ?? content.slice(1),
      ...at,
      ...(element.dataset.mime ? { mime: element.dataset.mime } : {}),
      ...(element.dataset.filename ? { filename: element.dataset.filename } : {}),
    })
  }
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      state.buffer += node.textContent ?? ""
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.mention) return mention(node)
    if (node.tagName === "BR") {
      state.buffer += "\n"
      return
    }
    Array.from(node.childNodes).forEach(visit)
  }
  Array.from(editor.childNodes).forEach((node, index, nodes) => {
    visit(node)
    if (node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName) && index < nodes.length - 1)
      state.buffer += "\n"
  })
  flush()
  const blank = parts.every((part) => part.type === "text" && part.content.replace(/[\n​]/g, "") === "")
  if (blank || parts.length === 0) return [{ type: "text", content: "", start: 0, end: 0 }]
  return parts
}

/** The caret's offset in the element's text; the end when the selection is elsewhere. */
export function editorCursor(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  if (selection.anchorNode) range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString().length
}

/** Put the caret at a text offset, walking text nodes only (the history recall's placement). */
export function setTextCursor(editor: HTMLElement, cursor: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let remaining = cursor
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }
}
