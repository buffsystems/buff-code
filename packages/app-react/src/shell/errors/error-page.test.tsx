import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { english } from "../../i18n/i18n"
import { I18nProvider } from "../../i18n/provider"
import { PlatformProvider } from "../../platform/context"
import type { FatalRendererErrorLog, Platform } from "../../platform/platform"
import { render, settle } from "../../test/render"
import { ErrorPage } from "./error-page"

const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

function desktop(calls: string[], records: FatalRendererErrorLog[]): Platform {
  return {
    platform: "desktop",
    os: "linux",
    version: "1.2.3",
    openExternal: () => undefined,
    restart: async () => undefined,
    notify: async () => undefined,
    storage: () => storage,
    recordFatalRendererError: async (error) => {
      records.push(error)
      calls.push("record")
    },
    exportDebugLogs: async () => {
      calls.push("export")
      return "/tmp/logs.zip"
    },
  }
}

function mount(platform: Platform) {
  const view = render(
    <I18nProvider storage={storage} initial={{ locale: "en", dictionary: english }}>
      <PlatformProvider value={platform}>
        <ErrorPage error={new Error("boom")} />
      </PlatformProvider>
    </I18nProvider>,
  )
  cleanup.push(view.unmount)
  return view
}

test("the fatal error goes into the app's log once, and the logs export runs after it", async () => {
  const calls: string[] = []
  const records: FatalRendererErrorLog[] = []
  const view = mount(desktop(calls, records))
  await settle()
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ platform: "desktop", os: "linux", version: "1.2.3" })
  expect(records[0]?.error).toContain("boom")
  const button = [...view.element.querySelectorAll("button")].find(
    (item) => item.textContent === english["error.page.action.exportLogs"],
  )
  expect(button).toBeDefined()
  act(() => button?.click())
  await settle()
  expect(calls).toEqual(["record", "export"])
})

test("the web has no logs to export", async () => {
  const platform: Platform = { ...desktop([], []), platform: "web", exportDebugLogs: undefined }
  const view = mount(platform)
  await settle()
  const labels = [...view.element.querySelectorAll("button")].map((item) => item.textContent)
  expect(labels).not.toContain(english["error.page.action.exportLogs"])
})
