import { expect, test } from "bun:test"
import { Schema } from "effect"
import { HighlightsStore, loadReleaseHighlights } from "./highlights"
import { Persistence } from "@/runtime/persistence/schema"

test("highlight persistence defaults missing or invalid versions and round-trips valid versions", () => {
  const decode = Schema.decodeUnknownSync(Persistence.withInitial(HighlightsStore, { version: undefined }))
  expect(decode({})).toEqual({ version: undefined })
  expect(decode({ version: null })).toEqual({ version: undefined })
  const value = decode({ version: "1.2.3", legacy: true })
  expect(value).toEqual({ version: "1.2.3" })
  expect(Schema.encodeSync(HighlightsStore)(value)).toEqual(value)
})

const item = (title: string) => ({ title, description: `${title}.` })
const changelog = [
  {
    tag: "2.0.11-buff.40",
    highlights: [
      { source: "desktop", lang: "ru", items: [item("Очередь сообщений")] },
      { source: "desktop", lang: "en", items: [item("Message queue")] },
    ],
  },
  { tag: "2.0.11-buff.39", highlights: [{ source: "desktop", items: [item("Older")] }] },
]

test("release highlights follow the window's language; another language falls back to English", () => {
  expect(loadReleaseHighlights(changelog, "2.0.11-buff.40", "2.0.11-buff.39", "ru").map((h) => h.title)).toEqual([
    "Очередь сообщений",
  ])
  expect(loadReleaseHighlights(changelog, "2.0.11-buff.40", "2.0.11-buff.39", "en").map((h) => h.title)).toEqual([
    "Message queue",
  ])
  expect(loadReleaseHighlights(changelog, "2.0.11-buff.40", "2.0.11-buff.39", "de").map((h) => h.title)).toEqual([
    "Message queue",
  ])
})

test("highlights without a language are shown in every language", () => {
  expect(loadReleaseHighlights(changelog, "2.0.11-buff.39", undefined, "ru").map((h) => h.title)).toEqual(["Older"])
})
