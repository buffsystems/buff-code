// The desktop host's native pieces (#584), as the Solid desktop renderer binds them: commands
// chosen in the application menu run as the window's own commands, the menu and the main
// process's dialogs speak the window's language, and the first launch of a fresh install opens a
// new session in the «Default Project» folder.

import { createDesktopNativeBundle, DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { useEffect, useRef } from "react"
import { useCommands } from "../commands/provider"
import { serverKey } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useCore, useServers } from "../react/core"
import { useRoute } from "../router/router"
import { useTabs } from "./tabs/provider"
import { tabServer } from "./tabs/tabs"
import { abortableWait, watchMigration } from "./migration-status"
import { dismissToast, showToast, updateToast } from "./notifications/toast"

export function DesktopBridge() {
  const platform = usePlatform()
  const commands = useCommands()
  const i18n = useI18n()
  useEffect(() => platform.onMenuCommand?.((id) => commands.trigger(id)), [platform, commands])
  useEffect(() => {
    platform.setNativeTranslations?.(
      createDesktopNativeBundle(i18n.locale, (key) => {
        const text = i18n.t(key)
        return text === key ? DESKTOP_NATIVE_ENGLISH[key] : text
      }),
    )
  }, [platform, i18n])
  return (
    <>
      <FirstLaunchProject />
      <MigrationStatus />
    </>
  )
}

/** The bundled server's data migration as a progress toast (desktop: the sidecar). */
function MigrationStatus() {
  const core = useCore()
  const i18n = useI18n()
  const sidecar = useServers().find((conn) => conn.type === "sidecar")
  const failed = i18n.t("toast.migration.failed.title")
  useEffect(() => {
    if (!sidecar) return
    const server = core.registry.ensure(sidecar)
    const abort = new AbortController()
    const toast: { id?: number } = {}
    void watchMigration({
      status: (signal) => server.api().migration.v1.status({ signal }),
      signal: abort.signal,
      wait: abortableWait,
      progress(label) {
        if (label === undefined) {
          if (toast.id !== undefined) dismissToast(toast.id)
          toast.id = undefined
          return
        }
        if (toast.id === undefined) toast.id = showToast({ variant: "loading", title: label, persistent: true })
        else updateToast(toast.id, { title: label })
      },
      fail: (message) => showToast({ variant: "error", title: failed, description: message, duration: 10_000 }),
    })
    return () => {
      abort.abort()
      if (toast.id !== undefined) dismissToast(toast.id)
    }
  }, [core, sidecar, failed])
  return null
}

/**
 * The Solid DesktopFirstLaunchOnboarding: on the first launch, opened at Home with no tabs and only
 * the bundled server, a new session starts in the «Default Project» folder; any other first
 * launch only closes the question. Either way the main process records it once.
 */
function FirstLaunchProject() {
  const platform = usePlatform()
  const core = useCore()
  const tabs = useTabs()
  const servers = useServers()
  const route = useRoute()
  const latest = useRef({ route, servers })
  latest.current = { route, servers }
  const started = useRef(false)
  useEffect(() => {
    const finish = platform.finishFirstLaunch
    const firstLaunch = platform.firstLaunch
    if (!finish || !firstLaunch) return
    const decide = async () => {
      const pending = firstLaunch()
      if (pending === undefined) return false
      if (started.current) return true
      started.current = true
      if (!pending) return true
      await tabs.ready
      const { route, servers } = latest.current
      const server = servers[0]
      const fresh =
        route.name === "home" &&
        tabs.tabs().length === 0 &&
        !!server &&
        servers.every((conn) => conn.type === "sidecar")
      const directory = await finish(fresh).catch(() => null)
      if (!fresh || !directory || !server) return true
      const projects = core.serverState.projects(core.scope(serverKey(server)))
      projects.open(directory)
      projects.touch(directory)
      tabs.newDraft({ server: tabServer(serverKey(server)), directory })
      return true
    }
    const timer = setInterval(() => void decide().then((done) => done && clearInterval(timer)), 250)
    void decide().then((done) => done && clearInterval(timer))
    return () => clearInterval(timer)
  }, [platform, core, tabs])
  return null
}
