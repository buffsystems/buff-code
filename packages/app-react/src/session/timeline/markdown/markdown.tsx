import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useI18n } from "../../../i18n/provider"
import { previewImages, usePreviewImage, useReadImage } from "./image-preview"
import { createMarkdownView, type MarkdownInput } from "./markdown-view"

/**
 * Rendered markdown (#584). React owns only the element; the view controller patches its
 * contents, so a streaming delta never re-renders anything but this element's DOM.
 */
export function Markdown(props: MarkdownInput & { className?: string; onRendered?: () => void }) {
  const i18n = useI18n()
  const root = useRef<HTMLDivElement>(null)
  const labels = useRef({ copy: "", copied: "", image: "" })
  labels.current = {
    copy: i18n.t("ui.message.copy"),
    copied: i18n.t("ui.message.copied"),
    image: i18n.t("ui.imagePreview.alt"),
  }
  const readImage = useReadImage()
  const open = usePreviewImage()
  const preview = useRef(open)
  preview.current = open
  const rendered = useRef(props.onRendered)
  rendered.current = props.onRendered
  const view = useRef<ReturnType<typeof createMarkdownView>>(undefined)

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const created = createMarkdownView({
      root: element,
      labels: () => labels.current,
      readImage,
      onPainted: (root) => previewImages(root, (src, alt) => preview.current(src, alt), labels.current.image),
      onRendered: () => rendered.current?.(),
    })
    view.current = created
    return () => {
      view.current = undefined
      created.dispose()
    }
  }, [])

  useLayoutEffect(() => {
    view.current?.update({
      text: props.text,
      cacheKey: props.cacheKey,
      streaming: props.streaming,
      deferUntilReady: props.deferUntilReady,
    })
  }, [props.text, props.cacheKey, props.streaming, props.deferUntilReady])

  useEffect(() => {
    view.current?.relabel()
  }, [i18n])

  return <div ref={root} data-component="markdown" dir="auto" className={`ui-prose ui-prose--chat ${props.className ?? ""}`} />
}

const pace = 24
const immediate = 512
const snap = /[\s.,!?;:)\]]/

/**
 * A streaming text revealed at a reading pace rather than in network bursts; a finished or
 * rewritten text shows at once.
 */
export function usePacedValue(value: string, live: boolean) {
  const [shown, setShown] = useState(value)
  const state = useRef({ shown: value, timer: undefined as ReturnType<typeof setTimeout> | undefined, value, live })
  state.current.value = value
  state.current.live = live

  useEffect(() => {
    const current = state.current
    const sync = (text: string) => {
      current.shown = text
      setShown(text)
    }
    const clear = () => {
      clearTimeout(current.timer)
      current.timer = undefined
    }
    const run = () => {
      current.timer = undefined
      const text = current.value
      if (!current.live || !text.startsWith(current.shown) || text.length - current.shown.length <= immediate)
        return sync(text)
      const end = nextBoundary(text, current.shown.length)
      sync(text.slice(0, end))
      if (end < text.length) current.timer = setTimeout(run, pace)
    }
    if (!live || !value.startsWith(current.shown) || value.length - current.shown.length <= immediate) {
      clear()
      return sync(value)
    }
    if (value.length === current.shown.length || current.timer) return
    current.timer = setTimeout(run, pace)
  }, [value, live])

  useEffect(() => () => clearTimeout(state.current.timer), [])
  return shown
}

function step(size: number) {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(256, Math.ceil(size / 4))
}

function nextBoundary(text: string, start: number) {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  const boundary = Array.from({ length: max - end }, (_, index) => end + index).find((index) =>
    snap.test(text[index] ?? ""),
  )
  return boundary === undefined ? end : boundary + 1
}

/** Markdown of a streaming part, paced, deferred until its first render is ready. */
export function PacedMarkdown(props: { text: string; cacheKey: string; streaming: boolean; onRendered?: () => void }) {
  const value = usePacedValue(props.text, props.streaming)
  if (!value) return null
  return (
    <Markdown
      text={value}
      cacheKey={props.cacheKey}
      streaming={props.streaming}
      deferUntilReady
      onRendered={props.onRendered}
    />
  )
}
