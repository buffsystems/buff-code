import { createResource, createSignal, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { Markdown } from "@opencode/session-ui/markdown"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { mimeOf, previewKind } from "./file-content"
import { BuffMediaView } from "./media-view"
import { useBuffText } from "./i18n"
import "./file-preview.css"

/**
 * Свой просмотр для файлов, которые полезнее видеть, чем читать исходником (#451): Markdown и
 * Mermaid — «Просмотр / Исходник», PDF и видео — встроенным проигрывателем. Остальное — как было.
 */

const mermaid = (source: string) => "```mermaid\n" + source.trimEnd() + "\n```\n"

/** Файл как адрес для `<iframe>` / `<video>`: читается при показе и отпускается при закрытии. */
function useFileUrl(path: () => string) {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const [url] = createResource(path, async (file) => {
    const bytes = await sdk.api.file.read({ path: file, location: { directory: location().directory } })
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeOf(file) ?? "application/octet-stream" }))
  })
  onCleanup(() => {
    const current = url.latest
    if (current) URL.revokeObjectURL(current)
  })
  return url
}

function Embedded(props: { path: string; kind: "pdf" | "video" }) {
  const url = useFileUrl(() => props.path)
  const { t } = useBuffText()
  return (
    <Show
      when={url.latest}
      fallback={<div class="px-6 py-4 text-text-weak">{url.error ? t("Could not open the file.") : t("Loading…")}</div>}
    >
      {(src) => <BuffMediaView src={src()} kind={props.kind} title={props.path} />}
    </Show>
  )
}

export function BuffFilePreview(props: { path: string | undefined; source: string; fallback: () => JSX.Element }) {
  const [source, setSource] = createSignal(false)
  const { t } = useBuffText()
  const kind = () => previewKind(props.path)
  return (
    <Switch fallback={props.fallback()}>
      <Match when={kind() === "pdf" || kind() === "video" ? (kind() as "pdf" | "video") : undefined}>
        {(media) => <Embedded path={props.path!} kind={media()} />}
      </Match>
      <Match when={kind() === "markdown" || kind() === "mermaid"}>
        <div class="buff-preview" data-component="buff-preview">
          <div class="buff-preview-switch" role="tablist">
            <button
              type="button"
              data-active={!source()}
              data-action="buff-preview-view"
              onClick={() => setSource(false)}
            >
              {t("Preview")}
            </button>
            <button
              type="button"
              data-active={source()}
              data-action="buff-preview-source"
              onClick={() => setSource(true)}
            >
              {t("Source")}
            </button>
          </div>
          <Show when={!source()} fallback={props.fallback()}>
            <div class="buff-preview-markdown" data-component="buff-preview-markdown">
              <Markdown
                text={kind() === "mermaid" ? mermaid(props.source) : props.source}
                cacheKey={`buff-preview:${props.path}`}
              />
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
