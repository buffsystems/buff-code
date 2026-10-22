import { onCleanup, Show, type JSX } from "solid-js"
import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import type { BuffTextAttachmentPart, PathAttachmentPart } from "@/composer/state"
import { usePlatform } from "@/runtime/platform/platform"
import { mediaKind } from "./file-content"
import { useBuffText } from "./i18n"
import { BuffMediaView } from "./media-view"
import "./attachment-preview.css"

/**
 * Просмотр вложений поля ввода (#459). Файл, ушедший путём, показывается по байтам, которые
 * человек выбрал (они в памяти с момента добавления), — тем же просмотром, что файлы проекта.
 * После перезапуска байтов нет: тогда — «Открыть в приложении». Чип вставленного текста или
 * цитаты открывает текст целиком, его можно развернуть обратно в поле или удалить.
 */

// Выбранные файлы этого окна: по ним показывается просмотр, пока окно открыто.
const files = new Map<string, File>()

export function rememberAttachmentFile(id: string, file: File): void {
  files.set(id, file)
}

function PathPreview(props: { part: PathAttachmentPart; local: boolean }) {
  const platform = usePlatform()
  const { t } = useBuffText()
  const file = files.get(props.part.id)
  const src = file ? URL.createObjectURL(file) : undefined
  onCleanup(() => src && URL.revokeObjectURL(src))
  const kind = mediaKind(props.part.mime)
  const openInApp = () => void platform.openPath?.(props.part.path)
  const fallback = () => (
    <div class="buff-attach-none">
      <span>{file ? t("This file type is not shown here.") : t("The preview is available until the window restarts.")}</span>
      <Show when={props.local && platform.openPath}>
        <Button size="normal" variant="neutral" data-action="buff-attachment-open" onClick={openInApp}>
          {t("Open in app")}
        </Button>
      </Show>
    </div>
  )
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{props.part.filename}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-attach" data-component="buff-attachment-preview">
          <Show when={props.part.note}>
            {(note) => <div class="buff-attach-note">{t(note())}</div>}
          </Show>
          <Show when={src && kind} fallback={fallback()}>
            <BuffMediaView src={src!} kind={kind!} title={props.part.filename} fallback={fallback} />
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function TextPreview(props: { part: BuffTextAttachmentPart; onExpand: () => void; onRemove: () => void }) {
  const dialog = useDialog()
  const { t, n } = useBuffText()
  const label = () =>
    props.part.kind === "quote"
      ? BuffComposerParts.quoteLabel(props.part.text, t, n)
      : BuffComposerParts.pasteLabel(props.part.text, t, n)
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{label()}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-attach" data-component="buff-text-preview">
          <pre class="buff-preview-text">{props.part.text}</pre>
          <div class="buff-attach-actions">
            <Button
              size="normal"
              variant="neutral"
              data-action="buff-text-expand"
              onClick={() => {
                dialog.close()
                props.onExpand()
              }}
            >
              {t("Expand into text")}
            </Button>
            <Button
              size="normal"
              variant="ghost"
              data-action="buff-text-remove"
              onClick={() => {
                dialog.close()
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

/** Открыть вложение, у которого нет своего просмотра у апстрима: файл путём или чип текста. */
export function openBuffAttachment(
  dialog: ReturnType<typeof useDialog>,
  part: PathAttachmentPart | BuffTextAttachmentPart,
  actions: { local: boolean; expand: (part: BuffTextAttachmentPart) => void; remove: (id: string) => void },
): void {
  if (part.type === "path") return void dialog.show(() => <PathPreview part={part} local={actions.local} />)
  void dialog.show(() => (
    <TextPreview part={part} onExpand={() => actions.expand(part)} onRemove={() => actions.remove(part.id)} />
  ))
}

/** Миниатюра картинки, ушедшей файлом (#459): из выбранных байтов, пока окно открыто. */
export function BuffPathThumb(props: { part: PathAttachmentPart; onClick: () => void; fallback: () => JSX.Element }) {
  const file = files.get(props.part.id)
  const src = file && props.part.mime.startsWith("image/") ? URL.createObjectURL(file) : undefined
  onCleanup(() => src && URL.revokeObjectURL(src))
  return (
    <Show when={src} fallback={props.fallback()}>
      <img
        src={src}
        alt={props.part.filename}
        class="w-[58px] h-[46px] rounded-[6px] object-cover cursor-pointer"
        data-component="buff-path-thumb"
        onClick={() => props.onClick()}
      />
    </Show>
  )
}

/** Чип вставленного текста или цитаты в ряду вложений. */
export function BuffTextChip(props: { part: BuffTextAttachmentPart; onClick: () => void }) {
  const { t, n } = useBuffText()
  const label = () =>
    props.part.kind === "quote"
      ? BuffComposerParts.quoteLabel(props.part.text, t, n)
      : BuffComposerParts.pasteLabel(props.part.text, t, n)
  const first = () => props.part.text.split("\n", 1)[0]?.trim() ?? ""
  return (
    <button
      type="button"
      class="buff-text-chip"
      data-component="buff-text-chip"
      data-kind={props.part.kind}
      title={first()}
      onClick={() => props.onClick()}
    >
      <span class="buff-text-chip-label">{label()}</span>
      <span class="buff-text-chip-first">{first()}</span>
    </button>
  )
}
