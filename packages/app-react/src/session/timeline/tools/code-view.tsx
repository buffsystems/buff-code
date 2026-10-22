// Diffs and files in tool rows (#584): Pierre's vanilla viewers on the shared Shiki worker pool,
// as the Solid File component mounts them, with its Find (Mod+F in the diff last focused or pointed at).
// The row is told once the shadow DOM holds lines, so the virtualizer measures the real height.

import { File, FileDiff, type FileContents, type FileDiffMetadata } from "@pierre/diffs"
import { createDefaultOptions } from "@opencode/session-ui/pierre"
import { clearReadyWatcher, createReadyWatcher, notifyShadowReady } from "@opencode/session-ui/pierre/file-runtime"
import { getWorkerPool } from "@opencode/session-ui/pierre/worker"
import { sampledChecksum } from "@opencode/util/encode"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react"
import { createDiffFind } from "./diff-find"
import { DiffFindBar } from "./find-bar"

const large = 500_000

const style = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "var(--buff-code-font-size, 12px)",
  "--diffs-line-height": "24px",
  "--diffs-tab-size": 2,
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-gap-block": 0,
  "--diffs-gap-style": 0,
  "--diffs-min-number-column-width": "3ch",
  "--opencode-diffs-bg": "var(--code-block-bg)",
} as CSSProperties

type DiffInput = { fileDiff: FileDiffMetadata } | { before: FileContents; after: FileContents }

function isLarge(input: DiffInput) {
  if ("fileDiff" in input)
    return (
      Math.max(input.fileDiff.deletionLines.join("").length, input.fileDiff.additionLines.join("").length) > large
    )
  return Math.max(input.before.contents.length, input.after.contents.length) > large
}

// The viewer's own Find, alive while it is mounted.
function useFind(container: RefObject<HTMLDivElement | null>) {
  const [find] = useState(() =>
    createDiffFind({
      wrapper: () => container.current,
      getRoot: () => container.current?.querySelector("diffs-container")?.shadowRoot ?? undefined,
    }),
  )
  useEffect(() => find.mount(), [find])
  return find
}

function ready(root: ShadowRoot) {
  return root.querySelector("[data-line]") != null
}

/** A unified diff of one file, from a parsed patch or a before/after pair. */
export function DiffView(props: DiffInput & { onRendered?: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const find = useFind(container)
  const viewer = useRef<{ instance: FileDiff<undefined>; pool: string } | undefined>(undefined)
  const watcher = useRef(createReadyWatcher())
  const rendered = useRef(props.onRendered)
  rendered.current = props.onRendered
  const target = "fileDiff" in props ? props.fileDiff : undefined
  const before = "before" in props ? props.before : undefined
  const after = "after" in props ? props.after : undefined

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const input: DiffInput = target ? { fileDiff: target } : { before: before!, after: after! }
    const heavy = isLarge(input)
    const pool = heavy ? "none" : "word-alt"
    const options = {
      ...createDefaultOptions<undefined>("unified"),
      ...(heavy ? { lineDiffType: "none" as const, maxLineDiffLength: 0, tokenizeMaxLineLength: 1 } : {}),
      ...(target?.isPartial ? { hunkSeparators: "simple" as const } : {}),
    }
    if (viewer.current && viewer.current.pool !== pool) {
      viewer.current.instance.cleanUp()
      viewer.current = undefined
    }
    if (!viewer.current) {
      element.innerHTML = ""
      viewer.current = { instance: new FileDiff<undefined>(options, getWorkerPool(pool)), pool }
    }
    const instance = viewer.current.instance
    instance.setOptions(options)
    if (target) instance.render({ fileDiff: target, lineAnnotations: [], containerWrapper: element })
    if (!target && before && after) {
      const key = (contents: string) => (heavy ? sampledChecksum(contents) : sampledChecksum(contents, contents.length))
      instance.render({
        oldFile: { ...before, cacheKey: key(before.contents) },
        newFile: { ...after, cacheKey: key(after.contents) },
        lineAnnotations: [],
        containerWrapper: element,
      })
    }
    notifyShadowReady({
      state: watcher.current,
      container: element,
      getRoot: () => element.querySelector("diffs-container")?.shadowRoot ?? undefined,
      isReady: ready,
      settleFrames: 1,
      onReady: () => {
        rendered.current?.()
        find.refresh()
      },
    })
  }, [target, before?.contents, before?.name, after?.contents, after?.name])

  useLayoutEffect(
    () => () => {
      clearReadyWatcher(watcher.current)
      viewer.current?.instance.cleanUp()
      viewer.current = undefined
    },
    [],
  )

  return (
    <div data-component="file" data-mode="diff" dir="ltr" style={style} className="tool-code" tabIndex={-1} onFocus={find.claim}>
      <div ref={container} />
      <DiffFindBar find={find} />
    </div>
  )
}

/** One file's text, highlighted, as a write call created it. */
export function TextView(props: { file: FileContents; onRendered?: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const find = useFind(container)
  const watcher = useRef(createReadyWatcher())
  const rendered = useRef(props.onRendered)
  rendered.current = props.onRendered

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const instance = new File<undefined>({ ...createDefaultOptions<undefined>("unified"), overflow: "scroll" }, getWorkerPool("word-alt"))
    element.innerHTML = ""
    instance.render({ file: props.file, lineAnnotations: [], containerWrapper: element })
    notifyShadowReady({
      state: watcher.current,
      container: element,
      getRoot: () => element.querySelector("diffs-container")?.shadowRoot ?? undefined,
      isReady: ready,
      onReady: () => {
        rendered.current?.()
        find.refresh()
      },
    })
    return () => {
      clearReadyWatcher(watcher.current)
      instance.cleanUp()
    }
  }, [props.file.name, props.file.contents])

  return (
    <div data-component="file" data-mode="text" dir="ltr" style={style} className="tool-code" tabIndex={-1} onFocus={find.claim}>
      <div ref={container} />
      <DiffFindBar find={find} />
    </div>
  )
}
