// Markdown in the timeline (#584): the Solid window's Markdown component as a framework-free
// controller over one element. Completed text renders from the shared cache (or the worker);
// streaming text is projected by the worker into blocks — finished blocks as cached HTML, the
// open block live word by word, code fences highlighted incrementally by Shiki's stream
// tokenizer. The element carries data-markdown-ready once what it shows is current.

import { checksum } from "@opencode/util/encode"
import { shouldResetCodeTokens, type RenderedCodeState } from "@opencode/session-ui/markdown-code-state"
import { inlineCodeKind } from "@opencode/session-ui/markdown-inline-code-kind"
import { renderMermaidSvg } from "@opencode/session-ui/markdown-mermaid"
import { canReusePendingBlock, completedProjection } from "@opencode/session-ui/markdown-projection"
import type { Block, Projection } from "@opencode/session-ui/markdown-stream"
import {
  disposeMarkdownProjection,
  disposeStreamingCode,
  highlightStreamingCode,
  MarkdownWorkerDisposedError,
  MarkdownWorkerSupersededError,
  MarkdownWorkerUnavailableError,
  projectMarkdown,
} from "@opencode/session-ui/markdown-worker"
import { markdownBlockKey, type MarkdownToken } from "@opencode/session-ui/markdown-worker-protocol"
import {
  getCachedMarkdown,
  getReadyMarkdown,
  renderCachedMarkdown,
  touchCachedMarkdown,
  type MarkdownCacheEntry,
} from "./cache"
import { createMarkdownImages, type ReadMarkdownImage } from "./images"
import { createMarkdownRenderer } from "./live-renderer"

type CodeBlock = {
  key: string
  mode: "code"
  raw: string
  hash: string
  language: string
  complete: boolean
  generation: number
  stable: MarkdownToken[]
  unstable: MarkdownToken[]
}

type RenderedBlock = (MarkdownCacheEntry & { key: string; mode: Exclude<Block["mode"], "code"> }) | CodeBlock

type RenderResult = { text: string; blocks: RenderedBlock[]; ready: boolean }

export type CopyLabels = { copy: string; copied: string }

export type MarkdownInput = {
  text: string
  cacheKey?: string
  streaming?: boolean
  deferUntilReady?: boolean
}

const renderedCodeTokens = new WeakMap<HTMLDivElement, RenderedCodeState>()
const renderedMarkdown = new WeakMap<
  HTMLDivElement,
  { renderer: ReturnType<typeof createMarkdownRenderer>; raw: string }
>()
const shellLanguages = new Set(["bash", "sh", "shell", "zsh", "fish", "console", "terminal"])
const urlPattern = /^https?:\/\/[^\s<>()`"']+$/
let owners = 0

export function createMarkdownView(input: {
  root: HTMLDivElement
  labels: () => CopyLabels
  readImage?: ReadMarkdownImage
  /** Called on the element after each paint, to wire what it holds (image previews). */
  onPainted?: (root: HTMLDivElement) => void
  onRendered?: () => void
}) {
  const root = input.root
  const owner = `md${++owners}`
  const lifetime = new AbortController()
  const activeCodeKeys = new Set<string>()
  const completedCode = new Map<string, CodeBlock>()
  const images = input.readImage ? createMarkdownImages(input.readImage) : undefined
  const state = {
    input: { text: "" } as MarkdownInput,
    streamed: false,
    projection: undefined as Projection | undefined,
    projectionRun: 0,
    result: undefined as RenderResult | undefined,
    resultRun: 0,
    initial: undefined as RenderResult | undefined,
  }
  const copy = setupCodeCopy(root, input.labels)

  const live = () => state.input.streaming ?? false
  const currentProjection = () => {
    if (!live() && !state.streamed) return completedProjection(state.input.text)
    const value = state.projection
    if (value?.text === state.input.text) return value
    if (value?.text) return value
    return pendingProjection(state.input.text)
  }

  function update(next: MarkdownInput) {
    const first = !state.initial
    const changed = first || next.text !== state.input.text || next.streaming !== state.input.streaming
    state.input = next
    if (first) {
      state.initial = initialResult(
        next.text,
        next.cacheKey,
        next.streaming ? pendingProjection(next.text) : completedProjection(next.text),
        owner,
        next.deferUntilReady,
      )
      state.result = state.initial
    }
    if (!changed) return
    if (live()) state.streamed = true
    if (state.streamed) requestProjection()
    render()
    paint()
  }

  // The worker projects streaming text into blocks; only the latest request may publish.
  function requestProjection() {
    const run = ++state.projectionRun
    const text = state.input.text
    void projectMarkdown(owner, text, live())
      .then((projection) => {
        if (run !== state.projectionRun || lifetime.signal.aborted) return
        state.projection = projection
        render()
        paint()
      })
      .catch(() => undefined)
  }

  function render() {
    const text = state.input.text
    const value = !live() && !state.streamed ? completedProjection(text) : state.projection
    if (!value || value.text !== text) return
    const run = ++state.resultRun
    const publish = (result: RenderResult) => {
      if (run !== state.resultRun || lifetime.signal.aborted) return
      state.result = result
      paint()
    }
    if (!text) return publish({ text, blocks: [], ready: true })
    if (!state.streamed && state.initial?.ready && state.initial.text === text) return publish(state.initial)
    void renderBlocks(text, value).then(publish)
  }

  function renderBlocks(text: string, projection: Projection): Promise<RenderResult> {
    const base = state.input.cacheKey ?? checksum(text)
    return Promise.all(
      projection.blocks.map(async (block, index): Promise<RenderedBlock> => {
        const key = base ? `${base}:${index}:${block.mode}` : undefined
        const blockKey = markdownBlockKey(owner, state.input.cacheKey, index, block.mode)
        if (block.mode === "code") {
          const cached = completedCode.get(blockKey)
          if (block.complete && cached?.raw === block.raw) return cached
          const result = await highlight(block.src, block.language, blockKey, block.complete)
          const rendered: CodeBlock = {
            key: blockKey,
            mode: "code",
            raw: block.raw,
            hash: String(block.raw.length),
            complete: !!block.complete,
            ...result,
          }
          if (block.complete) completedCode.set(blockKey, rendered)
          return rendered
        }
        const ready = block.mode === "full" ? getReadyMarkdown(block, key) : undefined
        return {
          key: blockKey,
          mode: block.mode,
          ...(ready ?? (await renderCachedMarkdown(block, key, lifetime.signal))),
        }
      }),
    )
      .then((blocks) => ({ text, blocks, ready: true }))
      .catch(() =>
        lifetime.signal.aborted
          ? { text, blocks: [], ready: false }
          : {
              text,
              ready: true,
              blocks: [
                {
                  key: base ?? "fallback",
                  mode: "full" as const,
                  raw: text,
                  hash: checksum(text) ?? "",
                  html: fallback(text),
                },
              ],
            },
      )
  }

  function paint() {
    const result = state.result
    const text = state.input.text
    const content = text
      ? pendingBlocks(result, currentProjection(), state.input.cacheKey, owner, state.input.deferUntilReady)
      : []
    delete root.dataset.markdownReady
    if (content.length === 0) {
      disposeRenderedMarkdown(root)
      root.innerHTML = ""
      images?.update(root)
      if (result?.ready && result.text === text) root.dataset.markdownReady = ""
      input.onPainted?.(root)
      input.onRendered?.()
      return
    }
    const labels = input.labels()
    const nextCodeKeys = new Set(content.filter((block) => block.mode === "code").map((block) => block.key))
    activeCodeKeys.forEach((key) => {
      if (!nextCodeKeys.has(key)) disposeStreamingCode(key)
    })
    activeCodeKeys.clear()
    nextCodeKeys.forEach((key) => activeCodeKeys.add(key))
    content.forEach((block, index) => updateBlock(root, index, block, labels))
    while (root.children.length > content.length) {
      const child = root.lastElementChild
      if (!child) break
      disposeRenderedMarkdown(child)
      child.remove()
    }
    images?.update(root)
    root
      .querySelectorAll<HTMLElement>('[data-slot="markdown-copy-button"]')
      .forEach((button) => setCopyState(button, labels, button.dataset.copied === "true"))
    if (result?.ready && result.text === text) root.dataset.markdownReady = ""
    input.onPainted?.(root)
    input.onRendered?.()
  }

  return {
    update,
    /** Re-label the copy buttons after a language change. */
    relabel() {
      const labels = input.labels()
      root
        .querySelectorAll<HTMLElement>('[data-slot="markdown-copy-button"]')
        .forEach((button) => setCopyState(button, labels, button.dataset.copied === "true"))
    },
    dispose() {
      lifetime.abort()
      images?.dispose()
      copy()
      disposeRenderedMarkdown(root)
      if (state.streamed) disposeMarkdownProjection(owner)
      activeCodeKeys.forEach(disposeStreamingCode)
      completedCode.clear()
    },
  }
}

async function highlight(text: string, language: string | undefined, key: string, complete = false) {
  try {
    const result = await highlightStreamingCode(key, text, language ?? "text", complete)
    return { language: result.language, generation: result.generation, stable: result.stable, unstable: result.unstable }
  } catch (error) {
    if (
      !(error instanceof MarkdownWorkerDisposedError) &&
      !(error instanceof MarkdownWorkerSupersededError) &&
      !(error instanceof MarkdownWorkerUnavailableError)
    )
      console.error("Markdown highlighting worker failed", error)
    return { language: language ?? "text", generation: 0, stable: [], unstable: [[text, ""] as MarkdownToken] }
  }
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

function pendingProjection(text: string): Projection {
  return { text, blocks: text ? [{ raw: text, src: text, mode: "live" }] : [] }
}

function initialResult(
  text: string,
  key: string | undefined,
  projection: Projection,
  owner: string,
  deferUntilReady: boolean | undefined,
): RenderResult {
  if (!text) return { text, blocks: [], ready: true }
  const base = key ?? checksum(text)
  if (base) {
    const blocks = projection.blocks.flatMap((block, index) => {
      if (block.mode === "code") return []
      const cacheKey = `${base}:${index}:${block.mode}`
      const cached = block.mode === "full" ? getReadyMarkdown(block, cacheKey) : getCachedMarkdown(cacheKey)
      if (cached?.raw !== block.raw) return []
      if (block.mode !== "full") touchCachedMarkdown(cacheKey, cached)
      return [{ key: `${owner}:${cacheKey}`, mode: block.mode, ...cached }]
    })
    if (blocks.length === projection.blocks.length) return { text, blocks, ready: true }
  }
  if (deferUntilReady) return { text, blocks: [], ready: false }
  return {
    text,
    ready: false,
    blocks: [{ key: "initial", mode: "full", raw: text, hash: checksum(text) ?? "", html: fallback(text) }],
  }
}

function pendingBlocks(
  result: RenderResult | undefined,
  projection: Projection | undefined,
  cacheKey: string | undefined,
  owner: string,
  deferUntilReady: boolean | undefined,
): RenderedBlock[] {
  if (!result) return []
  if (!projection || result.text === projection.text) return result.blocks
  if (deferUntilReady) return result.blocks
  const initial = result.blocks.length === 1 && result.blocks[0]?.key === "initial"
  return projection.blocks.map((block, index) => {
    const current = initial ? undefined : result.blocks[index]
    if (current && canReusePendingBlock(current, block)) return current
    const key = markdownBlockKey(owner, cacheKey, index, block.mode)
    if (block.mode !== "code")
      return { key, mode: block.mode, raw: block.raw, hash: String(block.raw.length), html: fallback(block.src) }
    return {
      key,
      mode: block.mode,
      raw: block.raw,
      hash: String(block.raw.length),
      language: block.language ?? "text",
      complete: !!block.complete,
      stable: [],
      generation: 0,
      unstable: [[block.src, ""] as MarkdownToken],
    }
  })
}

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href) || !URL.canParse(href)) return
  return new URL(href).toString()
}

function applyCodeMetadata(wrapper: HTMLElement, language: string | undefined) {
  if (language) wrapper.dataset.language = language
  if (!language) delete wrapper.dataset.language
  const shell = !!language && shellLanguages.has(language.toLowerCase())
  if (shell) wrapper.dataset.codeKind = "shell"
  if (!shell) delete wrapper.dataset.codeKind
}

function decorateMermaid(wrapper: HTMLElement, code: HTMLElement, complete: boolean) {
  if (!code.classList.contains("language-mermaid")) return clearMermaid(wrapper)
  const source = code.textContent ?? ""
  if (!source) return
  const diagram = wrapper.querySelector('[data-component="markdown-mermaid"]') ?? document.createElement("div")
  diagram.setAttribute("data-component", "markdown-mermaid")
  if (!diagram.parentElement) wrapper.appendChild(diagram)
  wrapper.dataset.mermaidPending = "true"
  const text = complete ? source : source.slice(0, source.lastIndexOf("\n") + 1)
  if (!text) return
  const attempt = `${complete ? "complete" : "streaming"}:${text.length}`
  if (wrapper.dataset.mermaidAttempt === attempt) return
  wrapper.dataset.mermaidAttempt = attempt
  void renderMermaidSvg(text)
    .then((svg) => {
      if (!svg) {
        if (complete && code.textContent === source) clearMermaid(wrapper)
        return
      }
      if (!(code.textContent ?? "").startsWith(text)) return
      diagram.innerHTML = svg
      delete wrapper.dataset.mermaidPending
      wrapper.dataset.mermaidReady = "true"
    })
    .catch(() => {
      if (!complete || code.textContent !== source) return
      clearMermaid(wrapper)
    })
}

function clearMermaid(wrapper: HTMLElement) {
  delete wrapper.dataset.mermaidAttempt
  delete wrapper.dataset.mermaidPending
  delete wrapper.dataset.mermaidReady
  wrapper.querySelector('[data-component="markdown-mermaid"]')?.remove()
}

function markCodeLinks(root: HTMLElement) {
  root.querySelectorAll(":not(pre) > code").forEach((code) => {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null
    if (!href) return parentLink?.replaceWith(code)
    if (parentLink) return void (parentLink.href = href)
    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  })
}

function markInlineCode(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(":not(pre) > code").forEach((code) => {
    delete code.dataset.inlineCodeKind
    const kind = inlineCodeKind(code.textContent ?? "")
    if (kind) code.dataset.inlineCodeKind = kind
  })
}

// Copy buttons are plain DOM inside the rendered HTML: a React root per code block would cost
// more than the block. The icons are lucide's copy and check.
const copyIcon =
  '<svg data-copy-icon aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const checkIcon =
  '<svg data-check-icon aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'

function createCopyButton(labels: CopyLabels) {
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-copy-button")
  const button = document.createElement("button")
  button.type = "button"
  button.className = "ui-btn ui-btn--icon ui-btn--ghost ui-btn--xs"
  button.innerHTML = copyIcon + checkIcon
  host.appendChild(button)
  setCopyState(host, labels, false)
  return host
}

function setCopyState(host: HTMLElement, labels: CopyLabels, copied: boolean) {
  const label = copied ? labels.copied : labels.copy
  const button = host.querySelector("button")
  button?.setAttribute("aria-label", label)
  button?.setAttribute("title", label)
  if (copied) return host.setAttribute("data-copied", "true")
  host.removeAttribute("data-copied")
}

function disposeRenderedMarkdown(root: Element) {
  const blocks = [
    ...(root instanceof HTMLDivElement && root.hasAttribute("data-markdown-block") ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLDivElement>("[data-markdown-block]")),
  ]
  blocks.forEach((block) => {
    renderedMarkdown.get(block)?.renderer.dispose()
    renderedMarkdown.delete(block)
  })
}

function setupCodeCopy(root: HTMLDivElement, labels: () => CopyLabels) {
  const timeouts = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
  const onClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLElement)) return
    const content = button.closest('[data-component="markdown-code"]')?.querySelector("code")?.textContent ?? ""
    if (!content || !navigator.clipboard) return
    await navigator.clipboard.writeText(content)
    const current = labels()
    setCopyState(button, current, true)
    clearTimeout(timeouts.get(button))
    timeouts.set(
      button,
      setTimeout(() => setCopyState(button, current, false), 2000),
    )
  }
  root.addEventListener("click", onClick)
  return () => {
    root.removeEventListener("click", onClick)
    timeouts.forEach((timeout) => clearTimeout(timeout))
  }
}

function updateBlock(container: HTMLDivElement, index: number, block: RenderedBlock, labels: CopyLabels) {
  const current = container.children[index]
  if (block.mode === "code") return updateCodeBlock(container, current, block, labels)
  const existing =
    current instanceof HTMLDivElement && current.dataset.markdownKey === block.key && !renderedCodeTokens.has(current)
      ? current
      : undefined
  if (existing?.dataset.markdownHash === block.hash) return
  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.style.display = "contents"
  const rendered = renderedMarkdown.get(next)
  // Keep live renderers in control of their DOM, including after completion.
  const source = rendered || block.mode === "live" ? document.createElement("div") : next
  source.innerHTML = block.html
  markInlineCode(source)
  markCodeLinks(source)
  if (rendered) {
    rendered.renderer.update(source.innerHTML, block.mode === "live", rendered.raw !== block.raw)
    rendered.raw = block.raw
    return
  }
  if (block.mode === "live") {
    next.replaceChildren()
    renderedMarkdown.set(next, { renderer: createMarkdownRenderer(next, source.innerHTML, true), raw: block.raw })
  }
  if (block.mode !== "live") {
    next.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
      const pre = code.parentElement!
      const wrapper = document.createElement("div")
      wrapper.dataset.component = "markdown-code"
      applyCodeMetadata(
        wrapper,
        Array.from(code.classList)
          .find((name) => name.startsWith("language-"))
          ?.slice(9),
      )
      pre.replaceWith(wrapper)
      wrapper.appendChild(pre)
      wrapper.appendChild(createCopyButton(labels))
      decorateMermaid(wrapper, code, true)
    })
  }
  if (existing) return
  if (!current) return void container.appendChild(next)
  disposeRenderedMarkdown(current)
  current.replaceWith(next)
}

function updateCodeBlock(container: HTMLDivElement, current: Element | undefined, block: CodeBlock, labels: CopyLabels) {
  const existing =
    current instanceof HTMLDivElement && current.dataset.markdownKey === block.key && renderedCodeTokens.has(current)
      ? current
      : undefined
  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.dataset.markdownComplete = block.complete ? "true" : "false"
  next.style.display = "contents"
  const tokenState = {
    language: block.language,
    generation: block.generation,
    stableCount: block.stable.length,
    unstable: block.unstable,
    raw: block.raw,
  }

  const code = existing?.querySelector("code")
  if (code instanceof HTMLElement) {
    const wrapper = code.closest('[data-component="markdown-code"]')
    if (wrapper instanceof HTMLElement) applyCodeMetadata(wrapper, block.language)
    code.className = `language-${block.language}`
    const previous = renderedCodeTokens.get(next)
    const reset = shouldResetCodeTokens(previous, {
      language: block.language,
      generation: block.generation,
      stableCount: block.stable.length,
      raw: block.raw,
    })
    const stableCount = reset ? 0 : previous!.stableCount
    const tail = [...block.stable.slice(stableCount), ...block.unstable]
    const prior = reset ? [] : previous!.unstable
    const prefix = prior.findIndex((token, index) => !sameToken(token, tail[index]))
    const keep = stableCount + (prefix < 0 ? Math.min(prior.length, tail.length) : prefix)
    while (code.children.length > keep) code.lastElementChild?.remove()
    tail
      .slice(keep - stableCount)
      .map(createTokenSpan)
      .forEach((span) => code.appendChild(span))
    renderedCodeTokens.set(next, tokenState)
    if (wrapper instanceof HTMLElement) decorateMermaid(wrapper, code, block.complete)
    return
  }

  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "markdown-code")
  applyCodeMetadata(wrapper, block.language)
  const pre = document.createElement("pre")
  pre.className = "shiki OpenCode"
  const codeElement = document.createElement("code")
  codeElement.className = `language-${block.language}`
  ;[...block.stable, ...block.unstable].map(createTokenSpan).forEach((span) => codeElement.appendChild(span))
  pre.appendChild(codeElement)
  wrapper.appendChild(pre)
  wrapper.appendChild(createCopyButton(labels))
  decorateMermaid(wrapper, codeElement, block.complete)
  next.appendChild(wrapper)
  renderedCodeTokens.set(next, tokenState)
  if (!current) return void container.appendChild(next)
  disposeRenderedMarkdown(current)
  current.replaceWith(next)
}

function sameToken(left: MarkdownToken, right: MarkdownToken | undefined) {
  return !!right && left[0] === right[0] && left[1] === right[1]
}

function createTokenSpan(token: MarkdownToken) {
  const span = document.createElement("span")
  span.setAttribute("style", token[1])
  span.textContent = token[0]
  return span
}
