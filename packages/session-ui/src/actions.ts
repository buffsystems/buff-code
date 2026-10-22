import type { JSX } from "solid-js"
import type { PromptFileAttachment } from "@opencode/client/promise"

export type SessionUserComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

/** An attachment delivered to the model as a path on the server instead of inline bytes. */
export type SessionUserAttachmentReference = {
  name: string
  mime: string
  path: string
}

/** Buff (#458): отказ хода — что пришло от модели и на какое сообщение человека она отвечала. */
export type SessionTurnFailure = {
  userMessageID: string
  providerID: string
  type: string
  message: string
  status?: number
}

export type SessionUserActions = {
  openAttachment?: (file: PromptFileAttachment) => void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /** Buff (#458): своя карточка отказа хода — с причиной и действиями; без неё показывается текст как есть. */
  turnFailure?: (failure: SessionTurnFailure) => JSX.Element
  /** Buff (#449): под ответом законченного хода — какие файлы он изменил, с откатом. */
  turnSummary?: (input: { userMessageID: string }) => JSX.Element
}
