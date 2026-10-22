// «Extensions» in «Session details» (#584), ported from the Solid SessionServerPanel: the server's
// card with MCP, plugins, skills and LSP, each a menu beside the panel. Every list loads while the
// summary is shown (so a menu opens on what is already known) and again as its menu opens, keeping
// the last answer on screen while it refreshes; each follows the server's updates. MCP switches go
// through the given controls (see new-session/context.tsx and use-mcp.ts).

import { Popover, PopoverContent, PopoverTrigger, Switch } from "@buff/ui/react"
import { configuredLsps } from "@opencode/app/react-reuse/configured-lsp"
import { pluginLabel } from "@opencode/app/react-reuse/plugin-labels"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { Blocks, ChevronDown, Code, GraduationCap, Plug, Server as ServerIcon } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { serverKey, serverName, type Server } from "../core/servers"
import { locationKey } from "../core/data/state"
import { useI18n } from "../i18n/provider"
import { useServerData, useServers } from "../react/core"
import { useSettings, useSettingsModel } from "../shell/settings-context"
import { ConfigLink, type Service } from "./config-link"
import "./summary.css"

/** The MCP switches: the draft's (recorded for a new session) or a live session's (applied at once). */
export type McpControls = {
  states: Record<string, boolean>
  preview: boolean
  pending: boolean
  change(name: string, enabled: boolean): void
}

const SERVICES = [
  { type: "mcp", icon: Plug, label: "session.summary.mcp" },
  { type: "plugins", icon: Blocks, label: "session.summary.plugins" },
  { type: "skills", icon: GraduationCap, label: "session.summary.skills" },
  { type: "lsp", icon: Code, label: "session.summary.lsp" },
] as const

type MenuProps = {
  server: Server
  directory: string
  service: (typeof SERVICES)[number]
  /** The summary is on screen: the lists load. */
  shown: boolean
  open: boolean
  /** Another service's menu is opening: this one must not take the focus back as it closes. */
  switching: boolean
  mobile?: boolean
  mcp?: McpControls
  onOpenChange(open: boolean): void
}

export function ServerPanel(props: {
  server: Server
  directory: string
  mcp?: McpControls
  shown?: boolean
  mobile?: boolean
}) {
  const i18n = useI18n()
  const model = useSettingsModel()
  const expanded = useSettings((settings) => settings.sessionSummary.serverExpanded)
  const shown = props.shown !== false
  const content = useId()
  // With several servers the card names the session's own.
  const servers = useServers()
  const name =
    servers.length < 2
      ? i18n.t("session.summary.server")
      : serverName(servers.find((conn) => serverKey(conn) === props.server.key) ?? props.server.conn)
  const [submenu, setSubmenu] = useState<Service>()
  useEffect(() => setSubmenu(undefined), [props.directory, shown, expanded])
  return (
    <section data-section="server" className="session-summary-card">
      <button
        type="button"
        className="session-summary-row session-summary-heading"
        aria-expanded={expanded}
        aria-controls={content}
        onClick={() => model.sessionSummary({ serverExpanded: !expanded })}
      >
        <ServerIcon aria-hidden />
        <span dir="auto" className="session-summary-label">
          {name}
        </span>
        <ChevronDown aria-hidden className="session-summary-disclosure" size={14} />
      </button>
      {expanded && (
        <div id={content} key={props.directory} className="session-summary-rows">
          {SERVICES.map((service) => {
            const menu: MenuProps = {
              server: props.server,
              directory: props.directory,
              service,
              shown,
              open: submenu === service.type,
              switching: submenu !== undefined && submenu !== service.type,
              mobile: props.mobile,
              mcp: props.mcp,
              onOpenChange: (open) => setSubmenu(open ? service.type : undefined),
            }
            if (service.type === "mcp") return <McpMenu key={service.type} {...menu} />
            if (service.type === "lsp") return <LspMenu key={service.type} {...menu} />
            return <CatalogMenu key={service.type} {...menu} />
          })}
        </div>
      )}
    </section>
  )
}

type Load = { loading: boolean; error?: unknown; retry(): void }

/** Loads while `shown`, again on `retry`; a failure is kept until the next attempt. */
function useLoad(shown: boolean, load: () => Promise<unknown>): Load {
  const [state, setState] = useState<{ loading: boolean; error?: unknown }>({ loading: false })
  const latest = useRef(load)
  latest.current = load
  const attempt = useRef(0)
  const retry = useCallback(() => {
    const id = ++attempt.current
    setState({ loading: true })
    latest.current().then(
      () => {
        if (id === attempt.current) setState({ loading: false })
      },
      (error: unknown) => {
        if (id === attempt.current) setState({ loading: false, error })
      },
    )
  }, [])
  useEffect(() => {
    if (shown) retry()
  }, [shown, retry])
  return { ...state, retry }
}

function McpMenu(props: MenuProps) {
  const i18n = useI18n()
  const location = { directory: props.directory }
  const data = props.server.data.location
  const preview = props.mcp?.preview === true
  const describe = useId()
  const load = useLoad(props.shown, async () => {
    data.mcpServer.invalidate(location)
    await Promise.all([data.mcpServer.sync(location), ...(preview ? [data.config.sync(location)] : [])])
  })
  const listed = useServerData(props.server, (state) => state.location[locationKey(location)]?.mcpServer)
  const config = useServerData(props.server, (state) => state.location[locationKey(location)]?.config)
  const servers = [...(listed ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const defaults: Record<string, boolean> = Object.fromEntries(
    (config ?? []).flatMap((entry) =>
      entry.type === "document"
        ? Object.entries(entry.info.mcp?.servers ?? {}).map(([name, value]) => [name, !value.disabled] as const)
        : [],
    ),
  )
  return (
    <ServicePopover
      {...props}
      load={load}
      ready={listed !== undefined && (!preview || config !== undefined)}
      empty={servers.length === 0}
      emptyTitle={i18n.t("session.summary.mcp.empty")}
    >
      <h3 className="session-service-title">{i18n.t("session.summary.mcp.title")}</h3>
      {preview && (
        <div className="session-service-message" data-slot="mcp-preview-hint">
          {i18n.t("session.summary.mcp.onCreation")}
        </div>
      )}
      {servers.map((server) => {
        const enabled = preview
          ? (props.mcp?.states[server.name] ?? defaults[server.name] ?? true)
          : server.status.status !== "disabled"
        const pending = !!props.mcp?.pending || (!preview && server.status.status === "pending")
        // Buff (#444): the status and its reason in the words of the settings and of /mcp.
        const text = BuffMcp.statusText(server.status, i18n.buff.t)
        const status = preview || text.tone === "ok" || text.tone === "off" ? undefined : text.label
        const change = (value: boolean) => {
          if (pending) return
          props.mcp?.change(server.name, value)
        }
        return (
          <label
            key={server.name}
            data-component="switch"
            className="session-mcp-row"
            data-disabled={pending || undefined}
            title={preview ? server.name : (text.reason ?? server.name)}
          >
            <span
              className="session-service-dot"
              data-status={preview ? undefined : server.status.status}
              aria-hidden
            />
            <span dir="auto" className="session-summary-label">
              {server.name}
            </span>
            {status && (
              <span className="session-service-status" aria-hidden>
                {status}
              </span>
            )}
            {status && (
              <span id={`${describe}-${server.name}`} className="sr-only">
                {status}
              </span>
            )}
            <Switch
              data-slot="switch-control"
              aria-label={server.name}
              aria-describedby={status ? `${describe}-${server.name}` : undefined}
              checked={enabled}
              // Not `disabled`: a switch pressed from the keyboard keeps the focus while it applies.
              aria-disabled={pending || undefined}
              aria-busy={!!props.mcp?.pending}
              onCheckedChange={change}
            />
          </label>
        )
      })}
    </ServicePopover>
  )
}

type CatalogItem = { name: string; status: string; error?: string }

function CatalogMenu(props: MenuProps) {
  const i18n = useI18n()
  const location = { directory: props.directory }
  const plugins = props.service.type === "plugins"
  const [items, setItems] = useState<CatalogItem[]>()
  const load = useLoad(props.shown, async () => {
    if (plugins) {
      const result = await props.server.api().plugin.list({ location })
      setItems(
        result.data
          .filter((plugin) => plugin.source.type !== "builtin")
          .map((plugin) => ({
            name: pluginLabel(plugin),
            status: plugin.state.status,
            error: plugin.state.status === "failed" ? plugin.state.error : undefined,
          })),
      )
      return
    }
    props.server.data.location.skill.invalidate(location)
    await props.server.data.location.skill.sync(location)
  })
  const retry = load.retry
  useEffect(
    () => props.server.event.location(props.directory).on(plugins ? "plugin.updated" : "skill.updated", () => retry()),
    [props.server, props.directory, plugins, retry],
  )
  const skills = useServerData(props.server, (state) => state.location[locationKey(location)]?.skill)
  const list: CatalogItem[] = plugins
    ? (items ?? [])
    : (skills ?? []).map((skill) => ({ name: skill.name, status: "active" }))
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <ServicePopover
      {...props}
      load={load}
      ready={plugins ? items !== undefined : skills !== undefined}
      empty={sorted.length === 0}
      emptyTitle={i18n.t(plugins ? "session.summary.plugins.empty" : "session.summary.skills.empty")}
    >
      <h3 className="session-service-title">
        {i18n.t(plugins ? "session.summary.plugins.configured" : "session.summary.skills.configured")}
      </h3>
      {sorted.map((item) => (
        <div key={item.name} className="session-service-row" title={item.error ?? item.name}>
          <span className="session-service-dot" data-status={item.status} aria-hidden />
          <span dir="auto" className="session-summary-label">
            {item.name}
          </span>
          {item.status === "failed" && (
            <span className="session-service-status">{i18n.t("session.summary.failed")}</span>
          )}
        </div>
      ))}
    </ServicePopover>
  )
}

function LspMenu(props: MenuProps) {
  const i18n = useI18n()
  const location = { directory: props.directory }
  const load = useLoad(props.shown, async () => {
    props.server.data.location.config.invalidate(location)
    await props.server.data.location.config.sync(location)
  })
  const retry = load.retry
  useEffect(
    () => props.server.event.location(props.directory).on("config.updated", () => retry()),
    [props.server, props.directory, retry],
  )
  const config = useServerData(props.server, (state) => state.location[locationKey(location)]?.config)
  const names = configuredLsps(config ?? [])
  return (
    <ServicePopover
      {...props}
      load={load}
      ready={config !== undefined}
      empty={names.length === 0}
      emptyTitle={i18n.t("session.summary.lsp.empty")}
    >
      <h3 className="session-service-title">{i18n.t("session.summary.lsp.configured")}</h3>
      {names.map((name) => (
        <div key={name} className="session-service-row">
          <span dir="auto" className="session-summary-label">
            {name}
          </span>
        </div>
      ))}
    </ServicePopover>
  )
}

function ServicePopover(
  props: MenuProps & { load: Load; ready: boolean; empty: boolean; emptyTitle: string; children: ReactNode },
) {
  const i18n = useI18n()
  const label = i18n.t(props.service.label)
  const Icon = props.service.icon
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl"
  const footer = (
    <div className="session-service-footer">
      <ConfigLink server={props.server} directory={props.directory} service={props.service.type} />
    </div>
  )
  const body = () => {
    if (!props.ready && props.load.loading)
      return (
        <div className="session-service-message" role="status">
          {i18n.t("common.loading")}
        </div>
      )
    if (props.load.error)
      return (
        <div className="session-service-message" role="alert">
          <p>{i18n.t("common.requestFailed")}</p>
          <button type="button" className="session-summary-row" onClick={props.load.retry}>
            {i18n.t("session.summary.retry")}
          </button>
        </div>
      )
    if (props.empty)
      return (
        <div className="session-service-empty">
          <strong>{props.emptyTitle}</strong>
          {footer}
        </div>
      )
    return (
      <>
        {props.children}
        {footer}
      </>
    )
  }
  return (
    <Popover
      modal={false}
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open)
        if (open && !props.load.loading) props.load.retry()
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="session-summary-row" data-expanded={props.open || undefined}>
          <Icon aria-hidden />
          <span className="session-summary-label">{label}</span>
          <ChevronDown aria-hidden className="session-summary-menu-indicator" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={props.mobile ? "top" : rtl ? "right" : "left"}
        align={props.mobile ? "end" : "start"}
        sideOffset={4}
        collisionPadding={16}
        aria-label={label}
        aria-busy={props.load.loading}
        className="session-service-menu"
        data-service={props.service.type}
        data-empty={(props.ready && !props.load.error && props.empty) || undefined}
        // Focus going back to this trigger would count as outside the next menu and close it.
        onCloseAutoFocus={(event) => {
          if (props.switching) event.preventDefault()
        }}
      >
        {body()}
      </PopoverContent>
    </Popover>
  )
}
