import { expect, test } from "bun:test"
import { createComposerDraft } from "../draft/draft"
import { memoryStorage } from "../../../test/storage"
import { createComposerController } from "./controller"

const text = (content: string) => [{ type: "text" as const, content, start: 0, end: content.length }]

test("a controller disconnected by an effect cleanup follows its draft again once reconnected", () => {
  const storage = memoryStorage()
  const draft = createComposerDraft({ host: { storage: () => storage }, target: { key: "prompt" } })
  const controller = createComposerController(draft, () => ({
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    attach: () => undefined,
    submit: { available: () => true, working: () => false, onSubmit: () => undefined, onStop: () => undefined },
  }))
  const editor = document.createElement("div")
  controller.mount(editor)
  // React's strict mode runs an effect's cleanup and the effect again on mount.
  const disconnect = controller.connect()
  disconnect()
  draft.set(text("restored while away"))
  controller.connect()
  expect(editor.textContent).toBe("restored while away")
  draft.set(text("and changed again"))
  expect(editor.textContent).toBe("and changed again")
})
