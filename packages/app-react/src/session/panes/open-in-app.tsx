// «Open in» (#584), the Solid window's open-in-app: on the desktop with its own server, the project
// or a file opens in an installed editor or terminal, or shows in the file manager. The main process
// says which apps are installed (checkAppExists); the chosen one is kept where the Solid window kept
// it (opencode.global.dat › open.app), so the choice carries over.

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  SplitButton,
  Tooltip,
} from "@buff/ui/react"
import {
  detectOpenAppOS,
  OPEN_APPS,
  openAppFileManager,
  openAppsForOS,
  type OpenApp,
} from "@opencode/app/react-reuse/open-in-app"
import { openInAppParentPath } from "@opencode/app/react-reuse/open-in-app-path"
import androidStudio from "@opencode/ui/app-icons/android-studio.svg"
import antigravity from "@opencode/ui/app-icons/antigravity.svg"
import cursor from "@opencode/ui/app-icons/cursor.svg"
import fileExplorer from "@opencode/ui/app-icons/file-explorer.svg"
import finder from "@opencode/ui/app-icons/finder.png"
import ghostty from "@opencode/ui/app-icons/ghostty.svg"
import iterm2 from "@opencode/ui/app-icons/iterm2.svg"
import powershell from "@opencode/ui/app-icons/powershell.svg"
import sublimeText from "@opencode/ui/app-icons/sublimetext.svg"
import terminal from "@opencode/ui/app-icons/terminal.png"
import textmate from "@opencode/ui/app-icons/textmate.png"
import vscode from "@opencode/ui/app-icons/vscode.svg"
import warp from "@opencode/ui/app-icons/warp.png"
import xcode from "@opencode/ui/app-icons/xcode.png"
import zed from "@opencode/ui/app-icons/zed.svg"
import zedDark from "@opencode/ui/app-icons/zed-dark.svg"
import { Copy, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { createPersisted, type Persisted } from "../../core/persisted"
import { isLocalServer, type ServerConnection } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import type { Platform } from "../../platform/platform"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"

type AppIconName = OpenAppOption["icon"]

const ICONS: Record<AppIconName, string> = {
  vscode,
  cursor,
  zed,
  "file-explorer": fileExplorer,
  finder,
  terminal,
  iterm2,
  ghostty,
  warp,
  xcode,
  "android-studio": androidStudio,
  antigravity,
  textmate,
  powershell,
  "sublime-text": sublimeText,
}

export type OpenAppOption = {
  id: OpenApp
  label: string
  icon: ReturnType<typeof openAppsForOS>[number]["icon"] | ReturnType<typeof openAppFileManager>["icon"]
  openWith?: string
}

// One answer per app for the window's life: the check spawns a process in the main process.
const installed = new Map<string, Promise<boolean>>()
const preferences = new WeakMap<Platform, Persisted<{ app: OpenApp }>>()

function preference(platform: Platform) {
  const existing = preferences.get(platform)
  if (existing) return existing
  const created = createPersisted<{ app: OpenApp }>({
    storage: platform.storage("opencode.global.dat"),
    key: "open.app",
    decode: (raw) => {
      const value: unknown = JSON.parse(raw)
      if (typeof value !== "object" || value === null || !("app" in value)) return undefined
      const app = OPEN_APPS.find((item) => item === value.app)
      return app ? { app } : undefined
    },
    initial: { app: "finder" },
  })
  preferences.set(platform, created)
  return created
}

function appInstalled(platform: Platform, app: string) {
  const cached = installed.get(app)
  if (cached) return cached
  const request = Promise.resolve(platform.checkAppExists?.(app))
    .then(Boolean)
    .catch(() => false)
  installed.set(app, request)
  return request
}

export function useOpenInApp(input: { conn: ServerConnection; directory: string | undefined }) {
  const platform = usePlatform()
  const i18n = useI18n()
  const os = detectOpenAppOS(platform)
  const apps = openAppsForOS(os)
  const fileManager = openAppFileManager(os)
  const [exists, setExists] = useState<Partial<Record<OpenApp, boolean>>>({})
  const [opening, setOpening] = useState(false)
  const stored = preference(platform)
  const chosen = useStore(stored.store, (value) => value.app)
  const canOpen = platform.platform === "desktop" && !!platform.openPath && isLocalServer(input.conn)

  useEffect(() => {
    if (!canOpen || !platform.checkAppExists) return
    const state = { live: true }
    void Promise.all(apps.map((app) => appInstalled(platform, app.openWith).then((ok) => [app.id, ok] as const))).then(
      (entries) => state.live && setExists(Object.fromEntries(entries)),
    )
    return () => void (state.live = false)
  }, [canOpen, platform, apps])

  const options: OpenAppOption[] = [
    { id: "finder", label: i18n.t(fileManager.label), icon: fileManager.icon },
    ...apps.filter((app) => exists[app.id]).map((app) => ({ ...app, label: i18n.t(app.label) })),
  ]
  const current = options.find((option) => option.id === chosen) ?? options[0]!
  const fail = (cause: unknown) =>
    showToast({
      variant: "error",
      title: i18n.t("common.requestFailed"),
      description: cause instanceof Error ? cause.message : String(cause),
    })

  /** Open the target with an app; the file manager with `reveal` shows the file selected in its folder. */
  const open = (app: OpenApp, target = input.directory, reveal = false) => {
    const openPath = platform.openPath
    if (opening || !canOpen || !openPath || !target) return
    const option = options.find((item) => item.id === app)
    setOpening(true)
    const request =
      app === "finder" && reveal && platform.revealPath
        ? platform.revealPath(target).then((shown) => (shown ? undefined : openPath(openInAppParentPath(target))))
        : openPath(target, option?.openWith)
    void request.catch(fail).finally(() => setOpening(false))
  }

  const copyPath = (target = input.directory) => {
    if (!target) return
    const write = platform.writeClipboardText ?? ((text: string) => navigator.clipboard.writeText(text))
    void write(target)
      .then(() => showToast({ variant: "success", title: i18n.t("common.copied"), description: target }))
      .catch(fail)
  }

  return {
    canOpen,
    opening,
    current,
    options,
    open,
    copyPath,
    select(app: OpenApp) {
      if (options.some((option) => option.id === app)) stored.set(() => ({ app }))
    },
  }
}

export type OpenInApp = ReturnType<typeof useOpenInApp>

export function AppIcon(props: { icon: AppIconName }) {
  if (props.icon === "zed")
    return (
      <>
        <img src={zed} alt="" aria-hidden className="size-4 shrink-0 dark:hidden" />
        <img src={zedDark} alt="" aria-hidden className="hidden size-4 shrink-0 dark:block" />
      </>
    )
  return <img src={ICONS[props.icon]} alt="" aria-hidden className="size-4 shrink-0" />
}

/** The side panel's button: open the project in the chosen app, or pick another one. */
export function OpenInAppButton(props: { state: OpenInApp }) {
  const i18n = useI18n()
  const state = props.state
  const label = i18n.buff.t("Open in {app}", { app: state.current.label })
  // The hint names the main action only, as in the Solid window: around the whole button it stayed
  // open over the chevron's menu, and Escape closed the hint instead of the menu.
  return (
    <SplitButton
      size="sm"
      variant="outline"
      className="session-review-v2-open-in-app"
      loading={state.opening}
      menuLabel={i18n.t("session.header.open.menu")}
      onClick={() => state.open(state.current.id)}
      menu={
        <>
          <DropdownMenuLabel>{i18n.t("session.header.openIn")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={state.current.id}>
            {state.options.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                disabled={state.opening}
                onSelect={() => {
                  state.select(option.id)
                  state.open(option.id)
                }}
              >
                <AppIcon icon={option.icon} />
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => state.copyPath()}>
            <Copy aria-hidden className="size-4" />
            {i18n.t("session.header.open.copyPath")}
          </DropdownMenuItem>
        </>
      }
    >
      <Tooltip side="bottom" content={label}>
        <span className="inline-flex">
          <AppIcon icon={state.current.icon} />
        </span>
      </Tooltip>
      <span className="sr-only">{label}</span>
    </SplitButton>
  )
}

/** A file's context menu in the trees: open it in an app, copy its path, add it to the chat. */
export function OpenInAppMenuItems(props: { state: OpenInApp; path: string; onAddToChat?: () => void }) {
  const i18n = useI18n()
  const state = props.state
  return (
    <>
      <DropdownMenuLabel>{i18n.t("session.header.openIn")}</DropdownMenuLabel>
      {state.options.map((option) => (
        <DropdownMenuItem
          key={option.id}
          disabled={state.opening}
          onSelect={() => {
            state.select(option.id)
            state.open(option.id, props.path, true)
          }}
        >
          <AppIcon icon={option.icon} />
          {option.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => state.copyPath(props.path)}>
        <Copy aria-hidden className="size-4" />
        {i18n.t("session.header.open.copyPath")}
      </DropdownMenuItem>
      {props.onAddToChat && (
        <DropdownMenuItem data-action="buff-file-to-chat" onSelect={props.onAddToChat}>
          <Plus aria-hidden className="size-4" />
          {i18n.buff.t("Add to chat")}
        </DropdownMenuItem>
      )}
    </>
  )
}
