// Setup mode's form in the MCP dock (#775/#860), as in the Solid window: the form's own title and
// note, a masked secret that is never shown back, own answers to a choice and to several options.

import { afterEach, expect, test } from "bun:test"
import type { FormInfo } from "@opencode/client/promise"
import { act } from "react"
import { settle } from "../../test/render"
import { renderSessionSlot } from "../test"
import { dockForm, McpForm } from "./mcp-dock"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

const setup = {
  id: "frm_setup",
  sessionID: "ses_test",
  title: "Connect the mail",
  metadata: { kind: "setup", note: "To read your **inbox**." },
  fields: [
    { key: "login", type: "string", title: "Login", required: true },
    { key: "password", type: "secret", title: "Password", required: true, placeholder: "app password" },
    {
      key: "folder",
      type: "string",
      title: "Folder",
      custom: true,
      options: [{ value: "inbox", label: "Inbox" }],
    },
    {
      key: "labels",
      type: "multiselect",
      title: "Labels",
      custom: true,
      options: [{ value: "work", label: "Work" }],
    },
    { key: "app", type: "external", title: "Create an app password", url: "https://mail.test/app" },
  ],
} as unknown as FormInfo

function type(input: Element | null | undefined, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input?.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function mount() {
  const replies: unknown[] = []
  const opened: string[] = []
  const view = renderSessionSlot(
    <McpForm request={setup} location={{ directory: "/repo" }} onOpenPage={(url) => opened.push(url)} />,
    { routes: { "session.form.reply": (input: unknown) => void replies.push(input) } },
  )
  cleanup.push(view.unmount)
  return { view, replies, opened }
}

test("the dock shows the session's setup form before the directory's MCP request", () => {
  const mcp = { ...setup, id: "frm_mcp", sessionID: "global", metadata: { kind: "mcp-elicitation" } } as FormInfo
  expect(dockForm([setup], [mcp], "/repo")?.id).toBe("frm_setup")
  expect(dockForm([], [mcp], "/repo")).toBeUndefined()
  expect(dockForm(undefined, [{ ...mcp, location: { directory: "/repo" } } as FormInfo], "/repo")?.id).toBe("frm_mcp")
})

test("a setup form: its title and note, a masked secret, a link to open", async () => {
  const { view, opened } = mount()
  await settle()
  expect(view.element.querySelector('[data-component="buff-mcp-form"]')?.getAttribute("data-kind")).toBe("setup")
  expect(view.element.textContent).toContain("Connect the mail")
  expect(view.element.querySelector("strong")?.textContent).toBe("inbox")
  const secret = view.element.querySelector<HTMLInputElement>('input[data-slot="buff-mcp-form-secret"]')
  expect(secret?.type).toBe("password")
  expect(secret?.autocomplete).toBe("new-password")
  expect(secret?.placeholder).toBe("app password")
  type(secret, "hunter2")
  expect(view.element.textContent).not.toContain("hunter2")
  act(() => view.element.querySelector<HTMLButtonElement>('[data-action="buff-mcp-form-open"]')?.click())
  expect(opened).toEqual(["https://mail.test/app"])
})

test("own answers: one wins over the choice, several are added to the picked ones and can be removed", async () => {
  const { view, replies } = mount()
  await settle()
  type(view.element.querySelector("input"), "me")
  type(view.element.querySelector('input[type="password"]'), "hunter2")
  type(view.element.querySelector('[data-slot="buff-mcp-form-own-one"]'), "Archive")
  const draft = () => view.element.querySelector('[data-slot="buff-mcp-form-own-draft"]')
  const add = () =>
    act(() => view.element.querySelector<HTMLButtonElement>('[data-action="buff-mcp-form-own-add"]')?.click())
  type(draft(), "Family")
  add()
  type(draft(), "Bills")
  add()
  const own = () => [...view.element.querySelectorAll('[data-slot="buff-mcp-form-own"]')]
  expect(own().map((row) => row.querySelector("span")?.textContent)).toEqual(["Family", "Bills"])
  act(() => own()[0]?.querySelector("button")?.click())
  expect(own().map((row) => row.querySelector("span")?.textContent)).toEqual(["Bills"])
  act(() => view.element.querySelector<HTMLButtonElement>('[data-action="buff-mcp-form-open"]')?.click())
  act(() => view.element.querySelector<HTMLButtonElement>('[data-action="buff-mcp-form-send"]')?.click())
  await settle()
  expect(replies).toEqual([
    {
      sessionID: "ses_test",
      formID: "frm_setup",
      answer: { login: "me", password: "hunter2", folder: "Archive", labels: ["Bills"], app: true },
    },
  ])
})
