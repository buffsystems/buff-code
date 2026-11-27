// The window's page must not let a frame leave (#595): a chat plugin runs model-written code,
// and the one way out a sandboxed frame keeps — taking itself to another address — is closed
// only by the policy of the page around it. Both pages the window is served from carry it.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const pages = ["../../../index.html", "../../../../desktop/src/renderer/react.html"]

test.each(pages)("%s lets a frame hold only what the window wrote into it", (page) => {
  const html = readFileSync(path.join(import.meta.dir, page), "utf8")
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ""
  const frames = /frame-src ([^;]*)/.exec(policy)?.[1]?.trim().split(/\s+/) ?? []
  expect(frames.toSorted()).toEqual(["blob:", "data:"])
  // The policy stands before any script of the page.
  expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"))
})
