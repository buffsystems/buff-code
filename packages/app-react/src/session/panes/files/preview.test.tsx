import { afterEach, expect, test } from "bun:test"
import { settle } from "../../../test/render"
import { renderSessionSlot } from "../../test"
import type { Files } from "./model"
import { FilePreview } from "./preview"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

test("a Markdown file's preview is the rendered document, as in the Solid window — not its source again", async () => {
  const view = renderSessionSlot(
    <FilePreview files={{} as Files} path="README.md" source={"# Tea shop\n\n- **catalog**"}>
      <span data-testid="source" />
    </FilePreview>,
  )
  cleanup.push(view.unmount)
  await settle()
  expect(view.element.querySelector('[data-component="buff-preview-markdown"] [data-component="markdown"]')).not.toBeNull()
  expect(view.element.querySelector('[data-component="buff-preview-markdown"] pre')).toBeNull()
})
