import { expect, test } from "bun:test"
import { act } from "react"
import { DialogProvider } from "../dialog/dialogs"
import { english } from "../i18n/i18n"
import { I18nProvider } from "../i18n/provider"
import { render, settle } from "../test/render"
import { filterCommands } from "./palette"
import { CommandProvider, useCommandRegistration } from "./provider"

const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }

test("the palette keybind opens a filterable list; Enter runs the selected command", async () => {
  const ran: string[] = []
  function Screen() {
    useCommandRegistration("screen", () => [
      { id: "settings.open", title: "Open settings", onSelect: () => ran.push("settings") },
      { id: "session.new", title: "New session", onSelect: () => ran.push("new") },
    ])
    return null
  }
  const view = render(
    <I18nProvider storage={storage} initial={{ locale: "en", dictionary: english }}>
      <DialogProvider>
        <CommandProvider>
          <Screen />
        </CommandProvider>
      </DialogProvider>
    </I18nProvider>,
  )
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "P", ctrlKey: true, shiftKey: true, bubbles: true }))
  })
  await settle()
  const input = document.querySelector<HTMLInputElement>('[data-component="command-palette"] input')
  expect(input).not.toBeNull()
  expect([...document.querySelectorAll('[role="option"]')].map((item) => item.textContent)).toEqual([
    "Open settings",
    "New session",
  ])
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, "new")
    input?.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe("New session")
  act(() => {
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
  await settle()
  expect(ran).toEqual(["new"])
  expect(document.querySelector('[data-component="command-palette"]')).toBeNull()
  view.unmount()
})

test("filtering needs every word somewhere in the command", () => {
  const options = [
    { id: "a", title: "Copy Session ID" },
    { id: "b", title: "Copy Project ID" },
  ]
  expect(filterCommands(options, "copy session").map((option) => option.id)).toEqual(["a"])
  expect(filterCommands(options, "").map((option) => option.id)).toEqual(["a", "b"])
})
