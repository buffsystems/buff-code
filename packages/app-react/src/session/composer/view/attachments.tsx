// The strip of attachments above the prompt (#584), ported from the Solid editor's
// ComposerAttachments: review comments, images, files sent by path, Buff's pasted-text chips and
// uploads in flight, each removable.

import { Tooltip } from "@buff/ui/react"
import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import type { BuffTextAttachmentPart, ContextItem, ImageAttachmentPart } from "@opencode/app/react-reuse/composer-schema"
import type { ComposerAttachment } from "@opencode/app/react-reuse/composer-types"
import { resolveBlobUrl } from "@opencode/app/react-reuse/drafts"
import { typeLabel } from "@opencode/session-ui/message-file"
import { X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"
import { pickedFile } from "../attachments/attachments"
import { uploadPercent, type Upload } from "../attachments/uploads"

type Comment = ContextItem & { key: string }

export function AttachmentStrip(props: {
  attachments: ComposerAttachment[]
  uploads: Upload[]
  comments: Comment[]
  activeCommentID?: string
  onAttachmentClick(attachment: ComposerAttachment): void
  onAttachmentRemove(attachment: ComposerAttachment): void
  onCommentClick(comment: Comment): void
  onCommentRemove(comment: Comment): void
}) {
  const i18n = useI18n()
  if (props.attachments.length === 0 && props.uploads.length === 0 && props.comments.length === 0) return null
  const remove = i18n.t("ui.promptInput.removeAttachment")
  return (
    <div data-component="composer-attachments" data-slot="composer-attachments" className="composer-attachments">
      <div data-slot="composer-attachments-scroll" className="composer-attachments__scroll">
        {props.comments.map((comment) => (
          <Item key={comment.key} removeLabel={remove} onRemove={() => props.onCommentRemove(comment)}>
            <Tooltip content={comment.comment}>
              <button
                type="button"
                className={
                  comment.key === props.activeCommentID
                    ? "composer-attachment__card composer-attachment__card--active"
                    : "composer-attachment__card"
                }
                onClick={() => props.onCommentClick(comment)}
              >
                <span className="composer-attachment__title">{comment.comment}</span>
                <span className="composer-attachment__meta">{commentPlace(comment)}</span>
              </button>
            </Tooltip>
          </Item>
        ))}
        {props.attachments.map((attachment) => (
          <Item key={attachment.id} removeLabel={remove} onRemove={() => props.onAttachmentRemove(attachment)}>
            <AttachmentCard attachment={attachment} onClick={() => props.onAttachmentClick(attachment)} />
          </Item>
        ))}
        {props.uploads.map((upload) => (
          <Item
            key={upload.id}
            slot="composer-upload"
            removeLabel={i18n.t("ui.promptInput.cancelUpload")}
            onRemove={() => upload.cancel()}
          >
            <div className="composer-attachment__card">
              <span className="composer-attachment__title">{upload.filename}</span>
              <span className="composer-attachment__meta">
                {i18n.t("ui.promptInput.uploading", { percent: uploadPercent(upload) })}
              </span>
            </div>
          </Item>
        ))}
      </div>
    </div>
  )
}

function Item(props: { slot?: string; removeLabel: string; onRemove(): void; children: ReactNode }) {
  return (
    <div className="composer-attachment" data-slot={props.slot}>
      {props.children}
      <button type="button" className="composer-attachment__remove" aria-label={props.removeLabel} onClick={props.onRemove}>
        <X aria-hidden />
      </button>
    </div>
  )
}

function AttachmentCard(props: { attachment: ComposerAttachment; onClick(): void }) {
  const i18n = useI18n()
  const attachment = props.attachment
  if (attachment.type === "buff-text") return <TextChip part={attachment} onClick={props.onClick} />
  if (attachment.type === "image" && attachment.mime.startsWith("image/"))
    return <ImageThumb part={attachment} onClick={props.onClick} />
  const picked = attachment.type === "path" ? pickedFile(attachment.id) : undefined
  if (picked && attachment.mime.startsWith("image/")) return <PickedThumb file={picked} name={attachment.filename} onClick={props.onClick} />
  const tooltip =
    attachment.type === "path"
      ? [attachment.path, attachment.note && i18n.buff.t(attachment.note)].filter(Boolean).join(" — ")
      : attachment.filename
  return (
    <Tooltip content={tooltip}>
      <button type="button" className="composer-attachment__card" onClick={props.onClick}>
        <span className="composer-attachment__title">{attachment.filename}</span>
        <span className="composer-attachment__meta">{typeLabel(attachment.filename, attachment.mime, i18n.t("ui.common.file"))}</span>
      </button>
    </Tooltip>
  )
}

function ImageThumb(props: { part: ImageAttachmentPart; onClick(): void }) {
  // Restored drafts and history carry image ids only; the bytes load when shown.
  const [url, setUrl] = useState<string | undefined>(props.part.blob.url)
  useEffect(() => {
    if (url) return
    let live = true
    void resolveBlobUrl(props.part.blob).then((value) => live && setUrl(value))
    return () => {
      live = false
    }
  }, [props.part.blob, url])
  return (
    <Tooltip content={props.part.filename}>
      <img src={url ?? ""} alt={props.part.filename} className="composer-attachment__image" onClick={props.onClick} />
    </Tooltip>
  )
}

function PickedThumb(props: { file: File; name: string; onClick(): void }) {
  const [src, setSrc] = useState<string | undefined>(undefined)
  useEffect(() => {
    const url = URL.createObjectURL(props.file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [props.file])
  return <img src={src} alt={props.name} className="composer-attachment__image" data-component="buff-path-thumb" onClick={props.onClick} />
}

function TextChip(props: { part: BuffTextAttachmentPart; onClick(): void }) {
  const i18n = useI18n()
  const label =
    props.part.kind === "quote"
      ? BuffComposerParts.quoteLabel(props.part.text, i18n.buff.t, i18n.buff.n)
      : BuffComposerParts.pasteLabel(props.part.text, i18n.buff.t, i18n.buff.n)
  const first = props.part.text.split("\n", 1)[0]?.trim() ?? ""
  return (
    <button
      type="button"
      className="composer-attachment__card"
      data-component="buff-text-chip"
      data-kind={props.part.kind}
      title={first}
      onClick={props.onClick}
    >
      <span className="composer-attachment__title buff-text-chip-label">{label}</span>
      <span className="composer-attachment__meta buff-text-chip-first">{first}</span>
    </button>
  )
}

function commentPlace(comment: Comment) {
  const name = comment.path.split(/[\\/]/).at(-1) ?? comment.path
  const selection = comment.selection
  if (!selection) return name
  return selection.startLine === selection.endLine
    ? `${name}:${selection.startLine}`
    : `${name}:${selection.startLine}-${selection.endLine}`
}
