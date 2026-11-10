// Публичная ссылка в консоли (#818): шаги диалогов без терминала.
import { expect, test } from "bun:test"
import { shareFlow, type ShareUi } from "../../src/feature-plugins/buff/share-flow"

const previews = [
  { id: "u1", role: "user" as const, text: "Привет" },
  { id: "a1", role: "assistant" as const, text: "Здравствуйте" },
]

/** A dialog double: answers in order, remembers what it was shown. */
function script(...answers: unknown[]) {
  const shown: { title: string; values?: unknown[]; current?: unknown; value?: string }[] = []
  const ui: ShareUi = {
    async select(dialog) {
      shown.push({ title: dialog.title, values: dialog.options.map((o) => o.value), current: dialog.current })
      return answers.shift() as never
    },
    async prompt(dialog) {
      shown.push({ title: dialog.title, value: dialog.value })
      return answers.shift() as string | undefined
    },
  }
  return { ui, shown }
}

test("the whole dialog: title, password, expiry, tools, live — in that order", async () => {
  const { ui, shown } = script("all", " Разбор ", "pw", "1d", true, false)
  const made = await shareFlow(ui, { session: "s1", sessionTitle: "Сессия", messages: previews, nowMs: 1000 })
  expect(made).toEqual({
    session: "s1",
    title: "Разбор",
    pass: "pw",
    expiresAt: 1000 + 86_400_000,
    tools: true,
    live: false,
  })
  expect(shown.map((s) => s.title)).toEqual([
    "Public link",
    "Link title",
    "Password (optional)",
    "Expires",
    "Show AI tool calls and their results",
    "Follow the session live",
  ])
  expect(shown[1]!.value).toBe("Сессия")
  expect(shown[0]!.current).toBe("all")
})

test("selected messages are ticked until done; an empty selection asks again; a preselected one starts ticked", async () => {
  const DONE = Symbol.for("buff.share.done")
  // a1 starts ticked; unticked, «done» on nothing asks again; u1 and a1 ticked, «done» accepted.
  const { ui, shown } = script("some", "a1", DONE, "u1", "a1", DONE, "T", "", "none", false, false)
  const made = await shareFlow(ui, {
    session: "s1",
    sessionTitle: undefined,
    messages: previews,
    preselect: ["a1"],
    nowMs: 5,
  })
  expect(made).toEqual({
    session: "s1",
    messages: ["u1", "a1"],
    title: "T",
    expiresAt: null,
    tools: false,
    live: false,
  })
  expect(shown[0]!.current).toBe("some")
  expect(shown.filter((s) => s.title === "Selected messages").length).toBe(5)
})

test("a cancel at any step makes no link; an empty title neither", async () => {
  expect(
    await shareFlow(script(undefined).ui, { session: "s", sessionTitle: "x", messages: previews, nowMs: 0 }),
  ).toBeUndefined()
  expect(
    await shareFlow(script("all", "  ").ui, { session: "s", sessionTitle: "x", messages: previews, nowMs: 0 }),
  ).toBeUndefined()
  expect(
    await shareFlow(script("all", "T", undefined).ui, {
      session: "s",
      sessionTitle: "x",
      messages: previews,
      nowMs: 0,
    }),
  ).toBeUndefined()
  expect(
    await shareFlow(script("all", "T", "", "1h", undefined).ui, {
      session: "s",
      sessionTitle: "x",
      messages: previews,
      nowMs: 0,
    }),
  ).toBeUndefined()
})
