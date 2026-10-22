import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { showToast } from "@/shell/notifications/toast"
import { useServer } from "@/runtime/server/current"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import {
  detectOpenAppOS,
  OPEN_APPS,
  openAppFileManager,
  openAppsForOS,
  type OpenApp,
} from "@/session/files/open-in-app-apps"
import { openInAppParentPath } from "@/session/files/open-in-app-path"

export {
  detectOpenAppOS,
  LINUX_OPEN_APPS,
  MAC_OPEN_APPS,
  OPEN_APPS,
  openAppFileManager,
  openAppsForOS,
  WINDOWS_OPEN_APPS,
  type OpenApp,
  type OpenAppOS,
} from "@/session/files/open-in-app-apps"

export const OpenAppPreferences = Persistence.struct({
  app: Schema.Literals(OPEN_APPS),
})

const appExistence = new Map<string, Promise<boolean>>()

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

export function useOpenInApp(input: { path: () => string }) {
  const platform = usePlatform()
  const server = useServer()
  const language = useLanguage()

  const os = createMemo(() => detectOpenAppOS(platform))
  const apps = createMemo(() => openAppsForOS(os()))
  const fileManager = createMemo(() => openAppFileManager(os()))

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) => checkAppExists(platform, app.openWith).then((ok) => [app.id, ok] as const)),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: language.t(fileManager().label), icon: fileManager().icon },
      ...apps()
        .filter((app) => exists[app.id])
        .map((app) => ({ ...app, label: language.t(app.label) })),
    ] as const
  })

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), OpenAppPreferences, { app: "finder" })
  const [menu, setMenu] = createStore({ open: false })
  const [openRequest, setOpenRequest] = createStore({
    app: undefined as OpenApp | undefined,
  })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal)
  const current = createMemo(
    () =>
      options().find((o) => o.id === prefs.app) ??
      options()[0] ??
      ({ id: "finder", label: fileManager().label, icon: fileManager().icon } as const),
  )
  const opening = createMemo(() => openRequest.app !== undefined)

  const selectApp = (app: OpenApp | "finder") => {
    if (!options().some((item) => item.id === app)) return
    setPrefs("app", app)
  }

  const openPath = (app: OpenApp | "finder", target = input.path(), reveal = false) => {
    if (opening() || !canOpen() || !platform.openPath) return
    if (!target) return

    const open = (path: string, openWith?: string) => platform.openPath!(path, openWith)
    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    setOpenRequest("app", app)
    const request =
      app === "finder" && reveal && platform.revealPath
        ? platform.revealPath(target).then((revealed) => (revealed ? undefined : open(openInAppParentPath(target))))
        : open(target, openWith)
    request
      .catch((err: unknown) => showRequestError(language, err))
      .finally(() => {
        setOpenRequest("app", undefined)
      })
  }

  const copyPath = (target = input.path()) => {
    if (!target) return
    navigator.clipboard
      .writeText(target)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("common.copied"),
          description: target,
        })
      })
      .catch((err: unknown) => showRequestError(language, err))
  }

  return {
    canOpen,
    opening,
    current,
    options,
    menu,
    setMenu,
    openPath,
    selectApp,
    copyPath,
  }
}

function checkAppExists(platform: ReturnType<typeof usePlatform>, app: string) {
  const cached = appExistence.get(app)
  if (cached) return cached
  const request = Promise.resolve(platform.checkAppExists?.(app))
    .then(Boolean)
    .catch(() => false)
  appExistence.set(app, request)
  return request
}
