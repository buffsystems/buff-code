// Images, audio and SVG in the panes (#584): the Solid FileMedia — the picture read from the
// workspace (keeping the previous one while the same file is read again, so a refresh does not
// blank it), or a note while it loads, failed or was removed. Other files show the fallback.

import { dataUrlFromMediaValue, mediaKindFromPath, normalizeMimeType, svgTextFromValue } from "@opencode/session-ui/pierre/media"
import { useEffect, useState, type ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"
import type { FileContent } from "../files/model"

export type ReadFile = (path: string) => Promise<FileContent | undefined>

type Remote = { key?: string; loading?: boolean; error?: boolean; src?: string; mime?: string }

export function FileMedia(props: {
  path: string
  /** The file's content when the caller already has it (the file view). */
  current?: FileContent
  deleted?: boolean
  readFile?: ReadFile
  fallback: ReactNode
  onLoad?: () => void
}) {
  const i18n = useI18n()
  const kind = mediaKindFromPath(props.path)
  const direct = (kind === "image" || kind === "audio") && props.current ? dataUrlFromMediaValue(props.current, kind) : undefined
  const request =
    (kind === "image" || kind === "audio") && !props.current && !props.deleted && props.readFile
      ? { key: `${kind}:${props.path}`, kind, read: props.readFile }
      : undefined
  const [remote, setRemote] = useState<Remote>({})

  useEffect(() => {
    if (!request) return void setRemote({})
    const active = { value: true }
    setRemote((current) =>
      current.key === request.key ? { ...current, loading: true, error: false } : { key: request.key, loading: true },
    )
    void request.read(props.path).then(
      (result) => {
        if (!active.value) return
        const src = dataUrlFromMediaValue(result, request.kind)
        if (!src) return setRemote({ key: request.key, error: true })
        setRemote({ key: request.key, src, mime: request.kind === "audio" ? normalizeMimeType(result?.mimeType) : undefined })
      },
      () => active.value && setRemote({ key: request.key, error: true }),
    )
    return () => {
      active.value = false
    }
    // The request is identified by its key.
  }, [request?.key])

  if (kind === "svg") {
    const source = props.current ? svgTextFromValue(props.current) : undefined
    const src = props.current ? dataUrlFromMediaValue(props.current, "svg") : undefined
    if (source === undefined && !src) return props.fallback
    return (
      <div className="flex flex-col gap-4 px-6 py-4">
        {source !== undefined && props.fallback}
        {src && (
          <div className="flex justify-center">
            <img src={src} alt={props.path} data-slot="file-media-image" onLoad={props.onLoad} />
          </div>
        )}
      </div>
    )
  }
  if (kind !== "image" && kind !== "audio") return props.fallback

  const src = direct ?? (request && remote.key === request.key && !remote.error ? remote.src : undefined)
  if (src && kind === "image")
    return (
      <div data-slot="file-media" className="flex justify-center px-6 py-4">
        <img src={src} alt={props.path} data-slot="file-media-image" onLoad={props.onLoad} />
      </div>
    )
  if (src)
    return (
      <div data-slot="file-media" className="flex justify-center px-6 py-4">
        <audio className="w-full max-w-xl" controls preload="metadata" onLoadedMetadata={props.onLoad}>
          <source src={src} type={remote.mime} />
        </audio>
      </div>
    )

  const label = i18n.t(kind === "image" ? "ui.fileMedia.kind.image" : "ui.fileMedia.kind.audio")
  const state = props.deleted
    ? "ui.fileMedia.state.removed"
    : request && (remote.key !== request.key || remote.loading)
      ? "ui.fileMedia.state.loading"
      : remote.error
        ? "ui.fileMedia.state.error"
        : "ui.fileMedia.state.unavailable"
  return (
    <div data-slot="file-media-state" className="ui-note flex min-h-40 items-center justify-center px-6 py-4 text-center">
      {i18n.t(state, { kind: label })}
    </div>
  )
}
