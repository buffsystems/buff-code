// Opening a composer attachment (#459), ported from Buff's attachment preview and the image
// preview: an image shown large; a file sent by path shown from the bytes picked in this window
// (until it restarts), with why it goes as a path; a pasted-text chip in full, to expand back into
// the prompt or delete.

import { Button, Callout, Dialog, DialogBody } from "@buff/ui/react"
import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import { expandChip } from "@opencode/app/react-reuse/attachment-prompt"
import { promptLength } from "@opencode/app/react-reuse/composer-prompt-parts"
import { mediaKind, type MediaKind } from "@opencode/app/react-reuse/file-content"
import { resolveBlobUrl } from "@opencode/app/react-reuse/drafts"
import type { BuffTextAttachmentPart, ImageAttachmentPart, PathAttachmentPart } from "@opencode/app/react-reuse/composer-schema"
import type { ComposerAttachment } from "@opencode/app/react-reuse/composer-types"
import { useEffect, useState } from "react"
import type { DialogStack } from "../../../dialog/dialogs"
import { useI18n } from "../../../i18n/provider"
import { pickedFile } from "../attachments/attachments"
import type { ComposerDraft } from "../draft/draft"
import "../buff/buff.css"

export function openAttachment(dialog: DialogStack, draft: ComposerDraft, attachment: ComposerAttachment) {
  if (attachment.type === "image")
    return void dialog.show((close) => <ImagePreview part={attachment} onClose={close} />)
  if (attachment.type === "path") return void dialog.show((close) => <PathPreview part={attachment} onClose={close} />)
  dialog.show((close) => (
    <TextPreview
      part={attachment}
      onClose={close}
      onExpand={() => {
        const next = expandChip(draft.current(), attachment.id)
        draft.set(next, promptLength(next))
      }}
      onRemove={() => draft.removeAttachment(attachment.id)}
    />
  ))
}

function ImagePreview(props: { part: ImageAttachmentPart; onClose(): void }) {
  const i18n = useI18n()
  const [src, setSrc] = useState<string | undefined>(props.part.blob.url)
  useEffect(() => {
    let live = true
    void resolveBlobUrl(props.part.blob).then((value) => live && setSrc(value))
    return () => {
      live = false
    }
  }, [props.part.blob])
  return (
    <Dialog open size="xl" title={props.part.filename} closeLabel={i18n.t("common.close")} onOpenChange={(open) => !open && props.onClose()}>
      <DialogBody>
        <div className="buff-preview" data-component="image-preview">
          {src && <img className="buff-preview__image" src={src} alt={props.part.filename} />}
        </div>
      </DialogBody>
    </Dialog>
  )
}

function PathPreview(props: { part: PathAttachmentPart; onClose(): void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const file = pickedFile(props.part.id)
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const kind = mediaKind(props.part.mime)
  return (
    <Dialog open size="xl" title={props.part.filename} closeLabel={i18n.t("common.close")} onOpenChange={(open) => !open && props.onClose()}>
      <DialogBody>
        <div className="buff-preview" data-component="buff-attachment-preview">
          {props.part.note && <Callout tone="info">{t(props.part.note)}</Callout>}
          {src && kind ? (
            <Media src={src} kind={kind} title={props.part.filename} />
          ) : (
            <span className="buff-billing__note">
              {file ? t("This file type is not shown here.") : t("The preview is available until the window restarts.")}
            </span>
          )}
        </div>
      </DialogBody>
    </Dialog>
  )
}

function Media(props: { src: string; kind: MediaKind; title: string }) {
  const i18n = useI18n()
  const [text, setText] = useState<string>()
  useEffect(() => {
    if (props.kind !== "text") return
    void fetch(props.src)
      .then((response) => response.text())
      .then(setText, () => setText(""))
  }, [props.src, props.kind])
  if (props.kind === "image") return <img className="buff-preview__image" data-component="buff-preview-image" src={props.src} alt={props.title} />
  if (props.kind === "pdf") return <iframe className="buff-preview__pdf" data-component="buff-preview-pdf" src={props.src} title={props.title} />
  if (props.kind === "video") return <video data-component="buff-preview-video" src={props.src} controls />
  if (props.kind === "audio") return <audio data-component="buff-preview-audio" src={props.src} controls />
  if (text === undefined) return <span className="buff-billing__note">{i18n.buff.t("Loading…")}</span>
  return (
    <pre className="ui-code-block buff-preview__text" data-component="buff-preview-text">
      {text}
    </pre>
  )
}

function TextPreview(props: { part: BuffTextAttachmentPart; onClose(): void; onExpand(): void; onRemove(): void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const label =
    props.part.kind === "quote"
      ? BuffComposerParts.quoteLabel(props.part.text, t, i18n.buff.n)
      : BuffComposerParts.pasteLabel(props.part.text, t, i18n.buff.n)
  return (
    <Dialog open size="lg" title={label} closeLabel={i18n.t("common.close")} onOpenChange={(open) => !open && props.onClose()}>
      <DialogBody>
        <div className="buff-preview" data-component="buff-text-preview">
          <pre className="ui-code-block buff-preview__text">{props.part.text}</pre>
          <div className="buff-preview__actions">
            <Button
              variant="outline"
              data-action="buff-text-expand"
              onClick={() => {
                props.onClose()
                props.onExpand()
              }}
            >
              {t("Expand into text")}
            </Button>
            <Button
              variant="ghost"
              data-action="buff-text-remove"
              onClick={() => {
                props.onClose()
                props.onRemove()
              }}
            >
              {t("Delete")}
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}
