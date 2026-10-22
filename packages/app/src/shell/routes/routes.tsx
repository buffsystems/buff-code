import { Route, useParams } from "@solidjs/router"
import { createMemo, lazy, onCleanup, onMount, Show, Suspense, type ParentProps } from "solid-js"
import { Home } from "@/home/route"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { BrowserAttachmentsProvider } from "@/session/browser/attachments"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { LayoutProvider } from "@/shell/state/layout"
import { SettingsSurfaceProvider } from "@/settings/surface"
import Shell from "@/shell/shell"
import { requireServerKey } from "./session"

export const File = lazy(() => import("@opencode/session-ui/file").then((module) => ({ default: module.File })))
const loadSessionRoute = () => Promise.all([import("@/session/route"), File.preload()]).then(([module]) => module)
const DraftRoute = lazy(() => import("@/new-session/route").then((module) => ({ default: module.DraftRoute })))
// Buff (#447): автоматизации.
const AutomationsScreen = lazy(() =>
  import("@/buff/automations/page").then((module) => ({ default: module.AutomationsScreen })),
)
// Buff (#448): сценарии.
const WorkflowsScreen = lazy(() =>
  import("@/buff/workflows/page").then((module) => ({ default: module.WorkflowsScreen })),
)
const SettingsScreen = lazy(() => import("@/settings/shell").then((module) => ({ default: module.SettingsScreen })))
const ConnectServerScreen = lazy(() =>
  import("@/servers/connect/screen").then((module) => ({ default: module.ConnectServerScreen })),
)
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(url: string) {
  const pathname = url.split(/[?#]/, 1)[0]
  if (pathname === "/new-session") return DraftRoute.preload().then(() => undefined)
  if (pathname === "/settings") return SettingsScreen.preload().then(() => undefined)
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)
  return Promise.resolve()
}

export function AppRoutes() {
  return (
    <Route component={AppLayout}>
      <Route path="/" component={Home} />
      <Route path="/settings" component={SettingsScreen} />
      <Route path="/automations" component={AutomationsScreen} />
      <Route path="/workflows" component={WorkflowsScreen} />
      {/* Buff (#584): the router preloads a lazy route component on link intent, but this route's
          component is an inline frame, so its lazy content is named here; otherwise a session
          opened from another page shows an empty panel while its module loads. */}
      <Route
        path="/server/:serverKey/session/:id"
        preload={() => void TargetSessionRouteContent.preload()}
        component={() => (
          <SessionRouteFrame>
            <Suspense
              fallback={
                <div class="flex min-h-0 flex-1 px-2 pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
                  <SessionPanelFrame raised />
                </div>
              }
            >
              <TargetServerRoute>
                <TargetSessionRouteContent />
              </TargetServerRoute>
            </Suspense>
          </SessionRouteFrame>
        )}
      />
      <Route path="/new-session" component={DraftRoute} />
    </Route>
  )
}

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string }>()
  const global = useGlobal()
  const connection = createMemo(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === requireServerKey(params.serverKey)),
  )

  return (
    <Show when={connection()} keyed>
      {(connection) => <ServerProvider conn={connection}>{props.children}</ServerProvider>}
    </Show>
  )
}

function AppLayout(props: ParentProps) {
  const servers = useServers()
  // Buff (#584): a window that starts on Home or the new session page has not loaded the session
  // screen's module; opening a session from there showed an empty panel while it loaded. It loads
  // once the window is idle, so the first session opens on a ready module.
  onMount(() => {
    const preload = () => void TargetSessionRouteContent.preload()
    if (typeof requestIdleCallback !== "function") {
      const timer = setTimeout(preload, 1_000)
      return onCleanup(() => clearTimeout(timer))
    }
    const handle = requestIdleCallback(preload, { timeout: 2_000 })
    onCleanup(() => cancelIdleCallback(handle))
  })
  return (
    <Show when={servers.list.length > 0} fallback={<ConnectServerScreen />}>
      <LayoutProvider>
        <SettingsSurfaceProvider>
          <BrowserAttachmentsProvider>
            <Shell>{props.children}</Shell>
          </BrowserAttachmentsProvider>
        </SettingsSurfaceProvider>
      </LayoutProvider>
    </Show>
  )
}
