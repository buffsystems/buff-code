import { BuffLinks } from "@opencode/schema/buff-links"
import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { createSimpleContext } from "@opencode/ui/context"
import { useDialog } from "@opencode/ui/context/dialog"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { DialogReleaseNotes, type Highlight } from "@/shell/updates/release-notes"

const CHANGELOG_URL = BuffLinks.changelog

export const HighlightsStore = Persistence.struct({
  version: Schema.UndefinedOr(Schema.String),
})

type ParsedRelease = {
  tag?: string
  highlights: Highlight[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    return text.length > 0 ? text : undefined
  }

  if (typeof value === "number") return String(value)
  return
}

function normalizeVersion(value: string | undefined) {
  const text = value?.trim()
  if (!text) return
  return text.startsWith("v") || text.startsWith("V") ? text.slice(1) : text
}

function parseMedia(value: unknown, alt: string): Highlight["media"] | undefined {
  if (!isRecord(value)) return
  const type = getText(value.type)?.toLowerCase()
  const src = getText(value.src) ?? getText(value.url)
  if (!src) return
  if (type !== "image" && type !== "video") return

  return { type, src, alt }
}

function parseHighlight(value: unknown): Highlight | undefined {
  if (!isRecord(value)) return

  const title = getText(value.title)
  if (!title) return

  const description = getText(value.description) ?? getText(value.shortDescription)
  if (!description) return

  const media = parseMedia(value.media, title)
  return { title, description, media }
}

// A group may name its language («ru», «en»): the window shows its own, else English; a group
// without a language is shown in every language.
function inLanguage(groups: Record<string, unknown>[], locale: string) {
  const lang = (group: Record<string, unknown>) => getText(group.lang)?.toLowerCase()
  const own = groups.filter((group) => lang(group) === locale)
  const english = groups.filter((group) => lang(group) === "en")
  return [...groups.filter((group) => !lang(group)), ...(own.length ? own : english)]
}

function parseRelease(value: unknown, locale: string): ParsedRelease | undefined {
  if (!isRecord(value)) return
  const tag = getText(value.tag) ?? getText(value.tag_name) ?? getText(value.name)

  if (!Array.isArray(value.highlights)) {
    return { tag, highlights: [] }
  }

  const highlights = inLanguage(value.highlights.filter(isRecord), locale).flatMap((group) => {
    const source = getText(group.source)
    if (!source) return []
    if (!source.toLowerCase().includes("desktop")) return []

    if (Array.isArray(group.items)) {
      return group.items.map((item) => parseHighlight(item)).filter((item): item is Highlight => item !== undefined)
    }

    const item = parseHighlight(group)
    if (!item) return []
    return [item]
  })

  return { tag, highlights }
}

function parseChangelog(value: unknown, locale: string): ParsedRelease[] | undefined {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.releases)
      ? value.releases
      : undefined
  if (!list) return
  return list
    .map((release) => parseRelease(release, locale))
    .filter((release): release is ParsedRelease => release !== undefined)
}

function sliceHighlights(input: { releases: ParsedRelease[]; current?: string; previous?: string }) {
  const current = normalizeVersion(input.current)
  const previous = normalizeVersion(input.previous)
  const releases = input.releases

  const start = (() => {
    if (!current) return 0
    const index = releases.findIndex((release) => normalizeVersion(release.tag) === current)
    return index === -1 ? 0 : index
  })()

  const end = (() => {
    if (!previous) return releases.length
    const index = releases.findIndex((release, i) => i >= start && normalizeVersion(release.tag) === previous)
    return index === -1 ? releases.length : index
  })()

  const highlights = releases.slice(start, end).flatMap((release) => release.highlights)
  const seen = new Set<string>()
  const unique = highlights.filter((highlight) => {
    const key = dedupeKey(highlight)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.slice(0, 5)
}

function dedupeKey(highlight: Highlight) {
  return [highlight.title, highlight.description, highlight.media?.type ?? "", highlight.media?.src ?? ""].join("\n")
}

export function loadReleaseHighlights(
  value: unknown,
  current: string | undefined,
  previous: string | undefined,
  locale: string,
) {
  const releases = parseChangelog(value, locale)
  if (!releases?.length) return []
  return sliceHighlights({ releases, current, previous })
}

export const { use: useHighlights, provider: HighlightsProvider } = createSimpleContext({
  name: "Highlights",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const dialog = useDialog()
    const settings = useSettings()
    const language = useLanguage()
    const [store, setStore, _, ready] = persisted("highlights.v1", HighlightsStore, { version: undefined })

    const [range, setRange] = createStore({
      from: undefined as string | undefined,
      to: undefined as string | undefined,
    })
    const state = { started: false }
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearTimer = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    }

    const markSeen = () => {
      if (!platform.version) return
      setStore("version", platform.version)
    }

    const start = (previous: string) => {
      if (!settings.general.releaseNotes()) {
        markSeen()
        return
      }

      const fetcher = platform.fetch ?? fetch
      const controller = new AbortController()
      onCleanup(() => {
        controller.abort()
        clearTimer()
      })

      fetcher(CHANGELOG_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
        .then((json) => {
          if (!json) return
          const highlights = loadReleaseHighlights(json, platform.version, previous, language.locale())
          if (controller.signal.aborted) return

          if (highlights.length === 0) {
            markSeen()
            return
          }

          timer = setTimeout(() => {
            timer = undefined
            markSeen()
            dialog.show(() => <DialogReleaseNotes highlights={highlights} />)
          }, 500)
        })
        .catch(() => undefined)
    }

    createEffect(() => {
      if (state.started) return
      if (!ready()) return
      if (!settings.ready()) return
      if (!platform.version) return
      state.started = true

      const previous = store.version
      if (!previous) {
        setStore("version", platform.version)
        return
      }

      if (previous === platform.version) return

      setRange({ from: previous, to: platform.version })
      start(previous)
    })

    return {
      ready,
      from: () => range.from,
      to: () => range.to,
      get last() {
        return store.version
      },
      markSeen,
    }
  },
})
