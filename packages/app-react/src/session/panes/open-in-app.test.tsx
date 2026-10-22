import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { english } from "../../i18n/i18n"
import { I18nProvider } from "../../i18n/provider"
import { PlatformProvider } from "../../platform/context"
import type { Platform } from "../../platform/platform"
import { render, settle } from "../../test/render"
import { memoryStorage } from "../../test/storage"
import { useOpenInApp, type OpenInApp } from "./open-in-app"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

const local = { type: "sidecar" as const, variant: "base" as const, http: { url: "http://127.0.0.1:1" } }
const remote = { type: "http" as const, http: { url: "https://example.test" } }

function desktop(calls: string[], global = memoryStorage()): Platform {
  return {
    platform: "desktop",
    os: "linux",
    openExternal: () => undefined,
    restart: async () => undefined,
    notify: async () => undefined,
    storage: (name) => (name === "opencode.global.dat" ? global : memoryStorage()),
    // Only VS Code ("code" on Linux) is installed.
    checkAppExists: async (app) => app === "code",
    openPath: async (path, app) => void calls.push(`open ${path}${app ? ` with ${app}` : ""}`),
    revealPath: async (path) => {
      calls.push(`reveal ${path}`)
      return false
    },
  }
}

function mount(platform: Platform, conn: typeof local | typeof remote) {
  const result: { state?: OpenInApp } = {}
  function Probe() {
    result.state = useOpenInApp({ conn, directory: "/work/project" })
    return null
  }
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  const view = render(
    <I18nProvider storage={storage} initial={{ locale: "en", dictionary: english }}>
      <PlatformProvider value={platform}>
        <Probe />
      </PlatformProvider>
    </I18nProvider>,
  )
  cleanup.push(view.unmount)
  return result
}

test("offers the file manager and the installed apps, and opens with the chosen one", async () => {
  const calls: string[] = []
  const global = memoryStorage()
  const result = mount(desktop(calls, global), local)
  await settle()
  expect(result.state?.canOpen).toBe(true)
  expect(result.state?.options.map((option) => option.id)).toEqual(["finder", "vscode"])
  act(() => result.state?.select("vscode"))
  expect(result.state?.current.id).toBe("vscode")
  expect(JSON.parse(global.getItem("open.app") ?? "null")).toEqual({ app: "vscode" })
  act(() => result.state?.open("vscode"))
  await settle()
  expect(calls).toEqual(["open /work/project with code"])
})

test("revealing a file the file manager cannot select opens its folder", async () => {
  const calls: string[] = []
  const result = mount(desktop(calls), local)
  await settle()
  act(() => result.state?.open("finder", "/work/project/src/a.ts", true))
  await settle()
  expect(calls).toEqual(["reveal /work/project/src/a.ts", "open /work/project/src"])
})

test("the Solid window's stored choice is kept; another server's files cannot be opened", async () => {
  const global = memoryStorage({ "open.app": JSON.stringify({ app: "vscode" }) })
  const result = mount(desktop([], global), local)
  await settle()
  expect(result.state?.current.id).toBe("vscode")
  expect(mount(desktop([]), remote).state?.canOpen).toBe(false)
})
