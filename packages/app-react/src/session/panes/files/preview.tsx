// Buff (#451): the preview of a Markdown / Mermaid file (rendered, with a Preview / Source switch)
// and of a PDF or a video (embedded) — the Solid window's buff/file-preview.tsx.

import { mimeOf, previewKind } from "@opencode/app/react-reuse/file-content"
import { useEffect, useState, type ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"
import { Markdown } from "../../timeline/markdown/markdown"
import type { Files } from "./model"

/** A Mermaid file is shown as the diagram its fenced block draws. */
const mermaid = (source: string) => "```mermaid\n" + source.trimEnd() + "\n```\n"

/**
 * Buff (#451): Markdown and Mermaid get a Preview / Source switch, PDF and video an embedded
 * player read when shown; everything else is the file itself.
 */
export function FilePreview(props: { files: Files; path: string; source: string; children: ReactNode }) {
  const i18n = useI18n()
  const kind = previewKind(props.path)
  const [source, setSource] = useState(false)
  if (kind === "pdf" || kind === "video") return <Embedded files={props.files} path={props.path} kind={kind} />
  if (kind !== "markdown" && kind !== "mermaid") return props.children
  return (
    <div className="buff-preview" data-component="buff-preview">
      <div className="buff-preview-switch" role="tablist">
        <button type="button" role="tab" aria-selected={!source} data-active={!source} data-action="buff-preview-view" onClick={() => setSource(false)}>
          {i18n.buff.t("Preview")}
        </button>
        <button type="button" role="tab" aria-selected={source} data-active={source} data-action="buff-preview-source" onClick={() => setSource(true)}>
          {i18n.buff.t("Source")}
        </button>
      </div>
      {source ? (
        props.children
      ) : (
        <div className="buff-preview-markdown" data-component="buff-preview-markdown">
          <Markdown text={kind === "mermaid" ? mermaid(props.source) : props.source} cacheKey={`buff-preview:${props.path}`} />
        </div>
      )}
    </div>
  )
}

function Embedded(props: { files: Files; path: string; kind: "pdf" | "video" }) {
  const i18n = useI18n()
  const [url, setUrl] = useState<{ src?: string; error?: boolean }>({})
  useEffect(() => {
    const active = { value: true, src: undefined as string | undefined }
    void props.files.readBytes(props.path).then(
      (bytes) => {
        if (!active.value) return
        active.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeOf(props.path) ?? "application/octet-stream" }))
        setUrl({ src: active.src })
      },
      () => active.value && setUrl({ error: true }),
    )
    return () => {
      active.value = false
      if (active.src) URL.revokeObjectURL(active.src)
    }
  }, [props.files, props.path])
  if (!url.src)
    return (
      <div className="ui-note px-6 py-4">
        {url.error ? i18n.buff.t("Could not open the file.") : i18n.buff.t("Loading…")}
      </div>
    )
  if (props.kind === "video") return <video src={url.src} controls className="buff-media-view" title={props.path} />
  return <iframe src={url.src} className="buff-media-view h-full w-full" title={props.path} />
}
