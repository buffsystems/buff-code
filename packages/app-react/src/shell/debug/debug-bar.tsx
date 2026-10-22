// The debug bar (#584), the Solid window's: the shown session's provider timings (TPS, TTFT, TTFA,
// E2E) from its messages, refined live by the step events, and — in a development build — the
// window's own diagnostics (navigation, frames, long tasks, input delay, INP, layout shift, heap)
// and a switch for the layout direction.

import { Tooltip } from "@buff/ui/react"
import {
  applyProviderMetricEvent,
  isProviderMetricEvent,
  projectedProviderMetrics,
  type ProviderMetrics,
  type ProviderMetricState,
} from "@opencode/app/react-reuse/provider-metrics"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useEffect, useMemo, useRef, useState } from "react"
import { createStore } from "../../core/store"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useStore } from "../../react/use-store"
import { useLocation, useRoute } from "../../router/router"
import { useServerByKey, useServerDataByKey } from "../server-data"
import { createDiagnosticsSampler, type Diagnostics } from "./sampler"

const NO_MESSAGES: SessionMessageInfo[] = []
const offline = createStore<{ status: string } | undefined>(undefined)

const fixed = (value: number | undefined, digits = 0) => (value === undefined ? undefined : value.toFixed(digits))
const time = (value: number | undefined) => (value === undefined ? undefined : `${Math.round(value)}`)
const ms = (value: number | undefined) => (value === undefined ? undefined : `${value.toFixed(0)}ms`)
const mb = (value: number | undefined) => {
  if (value === undefined) return
  const size = value / 1024 / 1024
  return `${size >= 1024 ? size.toFixed(0) : size.toFixed(1)}MB`
}
const duration = (value: number | undefined) => {
  if (value === undefined) return
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`
}
const over = (value: number | undefined, limit: number, low = false) =>
  value !== undefined && (low ? value < limit : value > limit)

export function DebugBar() {
  const i18n = useI18n()
  const diagnostics = import.meta.env.DEV
  const metrics = useSessionMetrics()
  const window = useDiagnostics(diagnostics)
  const navigation = useNavigationTime(diagnostics)
  const [rtl, setRtl] = useState(() => document.documentElement.dir === "rtl")
  const focus = useForceFocus(diagnostics)
  const na = i18n.t("debugBar.na").toUpperCase()
  const heap = window.heap ? window.heap.used / window.heap.limit : undefined

  return (
    <aside
      data-component="debug-bar"
      aria-label={i18n.t(diagnostics ? "debugBar.ariaLabel" : "debugBar.providerAriaLabel")}
      className="debug-bar"
    >
      <Cell
        label={i18n.t("debugBar.tps.label")}
        tip={i18n.t("debugBar.tps.tip")}
        value={fixed(metrics?.tps, 1)}
        na={na}
      />
      <Cell
        label={i18n.t("debugBar.ttft.label")}
        tip={i18n.t("debugBar.ttft.tip")}
        value={duration(metrics?.ttft)}
        na={na}
      />
      <Cell
        label={i18n.t("debugBar.ttfa.label")}
        tip={i18n.t("debugBar.ttfa.tip")}
        value={duration(metrics?.ttfa)}
        na={na}
      />
      <Cell
        label={i18n.t("debugBar.e2e.label")}
        tip={i18n.t("debugBar.e2e.tip")}
        value={duration(metrics?.e2e)}
        na={na}
      />
      {diagnostics && (
        <>
          <Cell
            label={i18n.t("debugBar.nav.label")}
            tip={i18n.t("debugBar.nav.tip")}
            value={navigation.pending ? "…" : time(navigation.duration)}
            bad={over(navigation.duration, 400)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.fps.label")}
            tip={i18n.t("debugBar.fps.tip")}
            value={time(window.fps)}
            bad={over(window.fps, 50, true)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.frame.label")}
            tip={i18n.t("debugBar.frame.tip")}
            value={time(window.gap)}
            bad={over(window.gap, 50)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.jank.label")}
            tip={i18n.t("debugBar.jank.tip")}
            value={window.jank === undefined ? undefined : `${window.jank}`}
            bad={over(window.jank, 8)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.long.label")}
            tip={i18n.t("debugBar.long.tip", { max: ms(window.long?.max) ?? na })}
            value={window.long ? `${time(window.long.block)}/${window.long.count}` : undefined}
            bad={over(window.long?.block, 200)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.delay.label")}
            tip={i18n.t("debugBar.delay.tip")}
            value={time(window.delay)}
            bad={over(window.delay, 100)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.inp.label")}
            tip={i18n.t("debugBar.inp.tip")}
            value={time(window.inp)}
            bad={over(window.inp, 200)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.cls.label")}
            tip={i18n.t("debugBar.cls.tip")}
            value={window.cls === undefined ? undefined : window.cls.toFixed(2)}
            bad={over(window.cls, 0.1)}
            na={na}
          />
          <Cell
            label={i18n.t("debugBar.mem.label")}
            tip={
              window.heap
                ? i18n.t("debugBar.mem.tip", { used: mb(window.heap.used) ?? na, limit: mb(window.heap.limit) ?? na })
                : i18n.t("debugBar.mem.tipUnavailable")
            }
            value={heap === undefined ? undefined : `${Math.round(heap * 100)}%`}
            bad={over(heap, 0.8)}
            na={na}
          />
          <Tooltip side="top" content={i18n.t("debugBar.direction.tip")}>
            <button
              type="button"
              className="debug-bar__cell debug-bar__toggle"
              aria-pressed={rtl}
              aria-label={`${i18n.t("debugBar.direction.label")}: ${i18n.t(rtl ? "debugBar.direction.rtl" : "debugBar.direction.ltr")}`}
              onClick={() => {
                document.documentElement.dir = rtl ? "ltr" : "rtl"
                setRtl(!rtl)
              }}
            >
              <span className="debug-bar__label">{i18n.t("debugBar.direction.label")}</span>
              <span className="debug-bar__value">
                {i18n.t(rtl ? "debugBar.direction.rtl" : "debugBar.direction.ltr")}
              </span>
            </button>
          </Tooltip>
          {focus && (
            <Tooltip side="top" content={i18n.t("debugBar.focus.tip")}>
              <button
                type="button"
                className="debug-bar__cell debug-bar__toggle"
                aria-pressed={focus.enabled}
                aria-label={`${i18n.t("debugBar.focus.label")}: ${i18n.t(focus.enabled ? "debugBar.focus.on" : "debugBar.focus.off")}`}
                onClick={focus.toggle}
              >
                <span className="debug-bar__label">{i18n.t("debugBar.focus.label")}</span>
                <span className="debug-bar__value">
                  {i18n.t(focus.enabled ? "debugBar.focus.on" : "debugBar.focus.off")}
                </span>
              </button>
            </Tooltip>
          )}
        </>
      )}
    </aside>
  )
}

/** Forced :focus on every focusable element, for styling focus rings (desktop development builds). */
function useForceFocus(diagnostics: boolean) {
  const platform = usePlatform()
  const [enabled, setEnabled] = useState(false)
  const set = diagnostics ? platform.setForceFocus : undefined
  useEffect(() => {
    if (!enabled || !set) return
    return () => void set(false).catch(() => undefined)
  }, [enabled, set])
  if (!set) return undefined
  return {
    enabled,
    toggle: () => void set(!enabled).then(() => setEnabled(!enabled)),
  }
}

function Cell(props: { label: string; tip: string; value: string | undefined; na: string; bad?: boolean }) {
  return (
    <Tooltip side="top" content={props.tip}>
      <div
        className="debug-bar__cell"
        data-dim={props.value === undefined || undefined}
        data-bad={props.bad || undefined}
      >
        <span dir="ltr" className="debug-bar__label">
          {props.label}
        </span>
        <span dir="ltr" className="debug-bar__value">
          {props.value ?? props.na}
        </span>
      </div>
    </Tooltip>
  )
}

/** The shown session's provider timings: projected from its messages, refined by live step events. */
function useSessionMetrics(): ProviderMetrics | undefined {
  const route = useRoute()
  const key = route.name === "session" ? route.serverKey : undefined
  const sessionID = route.name === "session" ? route.sessionID : undefined
  const server = useServerByKey(key)
  const messages = useServerDataByKey(key, (state) =>
    sessionID ? (state.session.message[sessionID] ?? NO_MESSAGES) : NO_MESSAGES,
  )
  const status = useStore(server?.connection ?? offline, (state) => state?.status)
  const projected = useMemo(() => projectedProviderMetrics(messages ?? NO_MESSAGES), [messages])
  const [live, setLive] = useState<ProviderMetrics>()
  useEffect(() => {
    setLive(undefined)
    if (!server || !sessionID || status !== "connected") return
    const state: ProviderMetricState = {}
    return server.event.listen((event) => {
      if (!isProviderMetricEvent(event) || event.data.sessionID !== sessionID) return
      applyProviderMetricEvent(state, event)
      if (state.latest) setLive(state.latest)
    })
  }, [server, sessionID, status])
  return live ?? projected
}

function useDiagnostics(enabled: boolean) {
  const [state, setState] = useState<Diagnostics>({})
  useEffect(() => {
    if (!enabled) return
    return createDiagnosticsSampler((patch) => setState((current) => ({ ...current, ...patch })))
  }, [enabled])
  return state
}

/** From a route change to its second painted frame, for routes into or out of a session. */
function useNavigationTime(enabled: boolean) {
  const location = useLocation()
  const path = location.pathname + location.search
  const previous = useRef(path)
  const started = useRef<number | undefined>(undefined)
  const [state, setState] = useState<{ duration?: number; pending: boolean }>({ pending: false })
  if (enabled && previous.current !== path && started.current === undefined) started.current = performance.now()
  useEffect(() => {
    const from = previous.current
    previous.current = path
    const at = started.current
    started.current = undefined
    if (at === undefined || !(from.includes("/session") || path.includes("/session"))) return
    setState({ pending: true })
    const frames = { one: 0, two: 0 }
    frames.one = requestAnimationFrame(() => {
      frames.two = requestAnimationFrame(() => setState({ duration: performance.now() - at, pending: false }))
    })
    return () => {
      cancelAnimationFrame(frames.one)
      cancelAnimationFrame(frames.two)
    }
  }, [path])
  return state
}
