import { Button, Dialog } from "@buff/ui/react"
import type {
  ModelRef,
  PromptAgentAttachment,
  PromptFileAttachment,
  SessionMessageUser,
} from "@opencode/client/promise"
import type { SessionUserAttachmentReference, SessionUserComment } from "@opencode/session-ui/actions"
import { attached, typeLabel } from "@opencode/session-ui/message-file"
import { getFilename, getFilenameTruncated } from "@opencode/util/path"
import { FileText } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"
import { useTimeline } from "../context"
import { MessageActionButton, useCopied, writeClipboard } from "./text"

function AttachmentCard(props: { title: string; hover?: string; onClick?: () => void; children: ReactNode }) {
  return (
    <div
      data-component="attachment-card"
      data-clickable={props.onClick ? "true" : undefined}
      className="timeline-attachment"
      title={props.hover}
      onClick={props.onClick}
    >
      <span data-slot="attachment-card-title" className="timeline-attachment__title">
        {props.title}
      </span>
      <span data-slot="attachment-card-subtitle" className="timeline-attachment__subtitle">
        {props.children}
      </span>
    </div>
  )
}

function Comments(props: { comments: SessionUserComment[]; bounded: boolean }) {
  const i18n = useI18n()
  const [expanded, setExpanded] = useState(false)
  const shown = props.bounded && !expanded ? props.comments.slice(0, 5) : props.comments
  return (
    <div data-slot="user-message-comments" data-bounded={props.bounded ? "true" : undefined}>
      {shown.map((comment, index) => (
        <AttachmentCard key={index} title={comment.comment} hover={comment.comment}>
          <FileText aria-hidden className="size-3.5" />
          <span>
            {getFilenameTruncated(comment.path, 14)}
            {comment.selection &&
              (comment.selection.startLine === comment.selection.endLine
                ? `:${comment.selection.startLine}`
                : `:${comment.selection.startLine}-${comment.selection.endLine}`)}
          </span>
        </AttachmentCard>
      ))}
      {props.bounded && props.comments.length > 5 && !expanded && (
        <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>
          {i18n.t("ui.common.showMore")}
        </Button>
      )}
    </div>
  )
}

function HighlightedText(props: { text: string; files: PromptFileAttachment[]; agents: PromptAgentAttachment[] }) {
  const references = [
    ...props.files.flatMap((file) =>
      file.mention ? [{ start: file.mention.start, end: file.mention.end, type: "file" as const }] : [],
    ),
    ...props.agents.flatMap((agent) =>
      agent.mention ? [{ start: agent.mention.start, end: agent.mention.end, type: "agent" as const }] : [],
    ),
  ].toSorted((a, b) => a.start - b.start)
  const { segments, last } = references.reduce(
    (result, reference) => {
      if (reference.start < result.last) return result
      const before = reference.start > result.last ? [{ text: props.text.slice(result.last, reference.start) }] : []
      return {
        segments: [
          ...result.segments,
          ...before,
          { text: props.text.slice(reference.start, reference.end), type: reference.type },
        ],
        last: reference.end,
      }
    },
    { segments: [] as { text: string; type?: "file" | "agent" }[], last: 0 },
  )
  const all: { text: string; type?: "file" | "agent" }[] =
    last < props.text.length ? [...segments, { text: props.text.slice(last) }] : segments
  return (
    <>
      {all.map((segment, index) => (
        <span key={index} data-highlight={segment.type}>
          {segment.type && segment.text.startsWith("@") ? (
            <>
              <span data-slot="user-message-mention-prefix">@</span>
              {segment.text.slice(1)}
            </>
          ) : (
            segment.text
          )}
        </span>
      ))}
    </>
  )
}

/** A prompt as sent: its text with mentions, attachments, comments, and who it went to. */
export function UserMessage(props: {
  sessionID: string
  message: SessionMessageUser
  text: string
  agent: string
  model: ModelRef
  modelName: string
  comments: SessionUserComment[]
  references: SessionUserAttachmentReference[]
}) {
  const i18n = useI18n()
  const timeline = useTimeline()
  const [copied, markCopied] = useCopied()
  const [reverting, setReverting] = useState(false)
  const [preview, setPreview] = useState<{ src: string; alt: string }>()
  const attachments = (props.message.files ?? []).filter(attached)
  const inlineFiles = (props.message.files ?? []).filter((file) => !!file.mention)
  const head = [props.agent ? props.agent[0]?.toUpperCase() + props.agent.slice(1) : "", props.modelName]
    .filter(Boolean)
    .join(" · ")
  const stamp = new Intl.DateTimeFormat(i18n.intl, { timeStyle: "short" }).format(props.message.time.created)
  const revert = timeline.actions.revert
  const copyLabel = copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")
  return (
    <div data-component="user-message" data-timeline-part-id={props.text ? `${props.message.id}:text:0` : undefined}>
      {props.text ? (
        <div data-slot="user-message-body" className="timeline-user__body">
          <div
            data-slot="user-message-text"
            dir="auto"
            data-comments={props.comments.length > 0 ? "true" : undefined}
            className="timeline-user__text"
          >
            <HighlightedText text={props.text} files={inlineFiles} agents={props.message.agents ?? []} />
            {props.comments.length > 0 && <Comments comments={props.comments} bounded />}
          </div>
        </div>
      ) : (
        props.comments.length > 0 && <Comments comments={props.comments} bounded={false} />
      )}
      {(attachments.length > 0 || props.references.length > 0) && (
        <div data-slot="user-message-attachments" className="timeline-user__attachments">
          {props.references.map((file) => (
            <AttachmentCard key={file.path} title={file.name} hover={file.path}>
              {typeLabel(file.name, file.mime, i18n.t("ui.common.file"))}
            </AttachmentCard>
          ))}
          {attachments.map((file, index) => {
            const url = file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`
            const name = file.name ?? i18n.t("ui.message.attachment.alt")
            if (file.mime.startsWith("image/"))
              return (
                <div
                  key={index}
                  data-slot="user-message-attachment"
                  data-type="image"
                  data-clickable="true"
                  className="timeline-user__image"
                  onClick={() => setPreview({ src: url, alt: name })}
                >
                  <img data-slot="user-message-attachment-image" src={url} alt={name} />
                </div>
              )
            const open = timeline.actions.openAttachment
            return (
              <AttachmentCard
                key={index}
                title={getFilename(name)}
                hover={name}
                onClick={open ? () => open(file) : undefined}
              >
                {typeLabel(name, file.mime, i18n.t("ui.common.file"))}
              </AttachmentCard>
            )
          })}
        </div>
      )}
      {(props.text || props.comments.length > 0) && (
        <div data-slot="user-message-copy-wrapper" className="timeline-meta timeline-meta--end">
          <span data-slot="user-message-meta-wrap" className="timeline-meta__text">
            {head && <span data-slot="user-message-meta">{head}</span>}
            {head && <span data-slot="user-message-meta-sep">{" · "}</span>}
            <span data-slot="user-message-meta-tail">{stamp}</span>
          </span>
          {revert && (
            <MessageActionButton
              icon="reset"
              label={i18n.t("ui.message.revertMessage")}
              disabled={reverting}
              onClick={() => {
                if (reverting) return
                setReverting(true)
                void Promise.resolve(revert({ sessionID: props.sessionID, messageID: props.message.id })).finally(() =>
                  setReverting(false),
                )
              }}
            />
          )}
          {props.text && (
            <MessageActionButton
              icon={copied ? "check" : "copy"}
              label={copyLabel}
              onClick={() => void writeClipboard(props.text).then((done) => done && markCopied())}
            />
          )}
        </div>
      )}
      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(undefined)} title={preview.alt} size="lg" closeLabel={i18n.t("ui.common.close")}>
          <img src={preview.src} alt={preview.alt} className="max-h-[70vh] w-full object-contain" />
        </Dialog>
      )}
    </div>
  )
}
