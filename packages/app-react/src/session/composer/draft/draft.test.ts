import { describe, expect, test } from "bun:test"
import { Skill } from "@opencode/schema/skill"
import { memoryStorage } from "../../../test/storage"
import { createComposerDraft } from "./draft"
import { flushDocuments } from "./document"
import { draftPromptTarget, sessionPromptTarget, workspaceStorage } from "./target"

function host(initial: Record<string, Record<string, string>> = {}) {
  const namespaces = new Map<string, ReturnType<typeof memoryStorage>>()
  return {
    namespaces,
    storage(name: string) {
      const existing = namespaces.get(name)
      if (existing) return existing
      const created = memoryStorage(initial[name])
      namespaces.set(name, created)
      return created
    },
  }
}

describe("composer draft", () => {
  test("types text, keeps attachments and moves the caret with it", async () => {
    const draft = createComposerDraft({ host: host(), target: draftPromptTarget("draft_1") })
    await draft.ready
    draft.set([
      { type: "text", content: "old", start: 0, end: 3 },
      { type: "path", id: "p1", filename: "a.txt", mime: "text/plain", path: "/a.txt" },
    ])
    draft.setText("updated")
    expect(draft.current()).toEqual([
      { type: "text", content: "updated", start: 0, end: 7 },
      { type: "path", id: "p1", filename: "a.txt", mime: "text/plain", path: "/a.txt" },
    ])
    expect(draft.cursor()).toBe(7)
  })

  test("inserts text at the caret and a mention over the typed @query", async () => {
    const draft = createComposerDraft({ host: host(), target: draftPromptTarget("draft_2") })
    await draft.ready
    draft.set([{ type: "text", content: "see @sr", start: 0, end: 7 }], 7)
    draft.addMention({ type: "file", path: "src", content: "@src", start: 0, end: 0 })
    expect(draft.current().map((part) => ("content" in part ? part.content : ""))).toEqual(["see ", "@src", " "])
    expect(draft.cursor()).toBe(9)
    draft.addText("x")
    expect(draft.current().map((part) => ("content" in part ? part.content : "")).join("")).toBe("see @src x")
  })

  test("a file added from the panes goes at the end of the text, after a space", async () => {
    const draft = createComposerDraft({ host: host(), target: draftPromptTarget("draft_append") })
    await draft.ready
    draft.set([{ type: "text", content: "look at", start: 0, end: 7 }], 2)
    draft.appendMention({ type: "file", path: "README.md", content: "@README.md", start: 0, end: 0 })
    const text = (value: typeof draft) => value.current().flatMap((part) => ("content" in part ? [part.content] : []))
    expect(text(draft).join("")).toBe("look at @README.md ")
    expect(draft.cursor()).toBe(19)
    const empty = createComposerDraft({ host: host(), target: draftPromptTarget("draft_append_empty") })
    await empty.ready
    empty.appendMention({ type: "file", path: "a.ts", content: "@a.ts", start: 0, end: 0 })
    expect(text(empty).join("")).toBe("@a.ts ")
  })

  test("a skill mention at the very start keeps a trailing space", async () => {
    const draft = createComposerDraft({ host: host(), target: draftPromptTarget("draft_3") })
    await draft.ready
    draft.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    draft.addMention(
      { type: "skill", id: Skill.ID.make("x"), name: Skill.Name.make("x"), content: "@x", start: 0, end: 0 },
      { start: 0, end: 0 },
    )
    expect(draft.current()[0]?.type).toBe("skill")
    expect(draft.cursor()).toBe(3)
  })

  test("editing clears a retry marker; setting the marker keeps the prompt", async () => {
    const draft = createComposerDraft({ host: host(), target: draftPromptTarget("draft_4") })
    await draft.ready
    draft.setRetry({ id: "msg_1" as never, agent: "build", providerID: "p", modelID: "m" })
    expect(draft.retry()?.agent).toBe("build")
    draft.setText("again")
    expect(draft.retry()).toBeUndefined()
  })

  test("saves once per window into the namespace and reads it back", async () => {
    const storage = host()
    const target = sessionPromptTarget("local", "/repo", "ses_1")
    const draft = createComposerDraft({ host: storage, target })
    await draft.ready
    draft.setText("a")
    draft.setText("ab")
    flushDocuments()
    const raw = storage.storage(workspaceStorage("/repo")).getItem("session:ses_1:prompt")
    expect(JSON.parse(raw ?? "{}").prompt[0].content).toBe("ab")
    const again = createComposerDraft({ host: storage, target })
    await again.ready
    expect(again.current()[0]).toEqual({ type: "text", content: "ab", start: 0, end: 2 })
  })

  test("moves a document from the legacy key", async () => {
    const legacy = JSON.stringify({ prompt: [{ type: "text", content: "kept", start: 0, end: 4 }], cursor: 4, context: { items: [] } })
    const target = sessionPromptTarget("local", "/repo", "ses_2")
    const storage = host({ "default.dat": { [target.previousKey!]: legacy } })
    const draft = createComposerDraft({ host: storage, target })
    await draft.ready
    expect(draft.current()[0]).toEqual({ type: "text", content: "kept", start: 0, end: 4 })
    expect(storage.storage("default.dat").getItem(target.previousKey!)).toBeNull()
  })

  test("comments replace each other while plain context stays", async () => {
    const draft = createComposerDraft({ host: host(), target: draftPromptTarget("draft_5") })
    await draft.ready
    draft.context.add({ type: "file", path: "a.ts" })
    draft.context.replaceComments([{ type: "file", path: "b.ts", comment: "fix", commentID: "c1" }])
    draft.context.replaceComments([{ type: "file", path: "c.ts", comment: "check", commentID: "c2" }])
    expect(draft.contextItems().map((item) => item.path)).toEqual(["a.ts", "c.ts"])
  })
})
