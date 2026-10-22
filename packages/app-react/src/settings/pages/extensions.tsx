// Extensions (#584), ported from the Solid window's settings/providers/extensions.tsx and
// workspaces/project-extensions.tsx: MCP servers, plugins, skills, commands, subagents, hooks and
// memory — Buff's pages (#444–#446) — of a server or a project; a project also lists its language
// servers. Each sub-page is a tab; the page opens at once and every list fills in as it loads.

import "../projects/projects.css"
import { Button, Count, Panel, TabPanel, Tabs } from "@buff/ui/react"
import { pluginLabels } from "@opencode/app/react-reuse/plugin-labels"
import { configuredLanguageServers } from "@opencode/app/react-reuse/project-lsp"
import { useQuery } from "@tanstack/react-query"
import { Box, ChevronDown, ChevronRight, Code } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import type { Server } from "../../core/servers"
import { BuffCustomSection } from "../../buff/settings/custom"
import { BuffHookSection } from "../../buff/settings/hooks"
import { BuffMcpSection } from "../../buff/settings/mcp"
import { BuffMemorySection } from "../../buff/settings/memory"
import { BuffSkillSection } from "../../buff/settings/skills"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { SettingsBody, SettingsHeader } from "../kit"
import { useSettingsScope } from "../scope"
import type { SettingsSubtab } from "../surface"

const SERVER_TABS = ["mcps", "plugins", "skills", "commands", "agents", "hooks", "memory"] as const
const PROJECT_TABS = [...SERVER_TABS, "lsps"] as const

export function SettingsExtensions(props: {
  project?: boolean
  subtab?: SettingsSubtab
  onSubtab: (subtab: SettingsSubtab) => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const scope = useSettingsScope()
  const tabs: readonly SettingsSubtab[] = props.project ? PROJECT_TABS : SERVER_TABS
  const current = props.subtab && tabs.includes(props.subtab) ? props.subtab : "mcps"
  const labels: Record<SettingsSubtab, string> = {
    mcps: i18n.t("settings.extensions.tab.mcps"),
    plugins: i18n.t("status.popover.tab.plugins"),
    skills: i18n.t("settings.extensions.tab.skills"),
    commands: t("Commands"),
    agents: t("Subagents"),
    hooks: t("Hooks"),
    memory: t("Memory"),
    lsps: i18n.t("project.settings.extensions.tab.lsps"),
  }
  const directory = props.project ? scope.project?.worktree : scope.directory
  const scopes = props.project ? (["project", "user"] as const) : (["user"] as const)
  const section = () => {
    if (current === "mcps") return <BuffMcpSection server={scope.server} directory={directory} scopes={scopes} />
    if (current === "plugins")
      return <Plugins server={scope.server} directory={props.project ? directory : undefined} />
    if (current === "skills") return <BuffSkillSection server={scope.server} directory={directory} scopes={scopes} />
    if (current === "commands" || current === "agents")
      return (
        <BuffCustomSection
          key={current}
          server={scope.server}
          kind={current === "commands" ? "command" : "agent"}
          directory={directory}
          scopes={scopes}
        />
      )
    if (current === "hooks") return <BuffHookSection server={scope.server} directory={directory} scopes={scopes} />
    if (current === "memory") return <BuffMemorySection server={scope.server} directory={directory} scopes={scopes} />
    return directory ? <LanguageServers server={scope.server} directory={directory} /> : null
  }
  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.tab.extensions")}
        description={i18n.t(
          props.project ? "project.settings.extensions.description" : "settings.extensions.description",
        )}
      />
      <SettingsBody>
        <Tabs
          variant="pill"
          label={i18n.t("settings.tab.extensions")}
          value={current}
          items={tabs.map((tab) => ({ id: tab, label: labels[tab] }))}
          onValueChange={(value) => {
            const next = tabs.find((tab) => tab === value)
            if (next) props.onSubtab(next)
          }}
          className="settings-subtabs w-fit"
        >
          <TabPanel value={current} className="settings-subtabs-content">
            {section()}
          </TabPanel>
        </Tabs>
      </SettingsBody>
    </>
  )
}

function ExtensionRow(props: { icon: ReactNode; name: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="buff-settings-row project-settings-extension-row">
      <div className="buff-settings-lead">
        {props.icon}
        <div className="buff-settings-copy">
          <span className="buff-settings-name truncate">{props.name}</span>
          {props.description && <span className="project-settings-extension-row-description">{props.description}</span>}
        </div>
      </div>
      {props.children}
    </div>
  )
}

function Plugins(props: { server: Server; directory?: string }) {
  const i18n = useI18n()
  const connected = useConnection(props.server).status === "connected"
  const shared = useQuery({
    queryKey: ["settings-plugins", props.server.key, ""],
    enabled: connected,
    queryFn: () =>
      props.server
        .api()
        .plugin.list()
        .then((result) => pluginLabels(result.data)),
  })
  const directory = props.directory
  const own = useQuery({
    queryKey: ["settings-plugins", props.server.key, directory ?? ""],
    enabled: connected && !!directory,
    queryFn: () =>
      props.server
        .api()
        .plugin.list({ location: { directory: directory ?? "" } })
        .then((result) => pluginLabels(result.data)),
  })
  const global = shared.data ?? []
  const rows = (names: readonly string[]) =>
    names.map((name) => <ExtensionRow key={name} icon={<Box aria-hidden />} name={name} />)

  if (!directory)
    return (
      <div className="settings-section">
        <div className="flex items-center justify-between gap-4">
          <span className="settings-section-title">{i18n.t("settings.extensions.availableAll")}</span>
          <span className="ui-note">{i18n.t("settings.extensions.manageConfig")}</span>
        </div>
        <Panel data-component="settings-list" data-variant="catalog">
          {rows(global)}
        </Panel>
      </div>
    )
  const projectOnly = (own.data ?? []).filter((name) => !global.includes(name))
  return (
    <div className="project-settings-extension-section">
      <div className="project-settings-extension-section-header">
        <div className="project-settings-extension-section-copy">
          <span>
            {i18n.t(
              projectOnly.length
                ? "project.settings.extensions.added"
                : "project.settings.extensions.empty.plugins.title",
            )}
          </span>
          {!projectOnly.length && (
            <span className="project-settings-extension-empty-description">
              {i18n.t("project.settings.extensions.empty.plugins.description")}
            </span>
          )}
        </div>
        <span>{i18n.t("settings.extensions.manageConfig")}</span>
      </div>
      {projectOnly.length > 0 && (
        <Panel data-component="settings-list" data-variant="catalog">
          {rows(projectOnly)}
        </Panel>
      )}
      <Shared count={global.length}>{rows(global)}</Shared>
    </div>
  )
}

function Shared(props: { count: number; children?: ReactNode }) {
  const i18n = useI18n()
  const [open, setOpen] = useState(false)
  if (!props.count) return null
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        leadingIcon={open ? ChevronDown : ChevronRight}
        onClick={() => setOpen((value) => !value)}
      >
        {i18n.t("project.settings.extensions.shared")}
        <Count>{props.count}</Count>
      </Button>
      {open && (
        <Panel data-component="settings-list" data-variant="catalog">
          {props.children}
        </Panel>
      )}
    </div>
  )
}

// The language servers a project's configuration names, with their status from the config only.
function LanguageServers(props: { server: Server; directory: string }) {
  const i18n = useI18n()
  const connected = useConnection(props.server).status === "connected"
  const config = useQuery({
    queryKey: [props.server.key, "settings-project-language-servers", props.directory],
    enabled: connected,
    retry: false,
    queryFn: () => props.server.api().config.get({ location: { directory: props.directory } }),
  })
  useEffect(
    () =>
      props.server.event.listen((event) => {
        if (event.type !== "config.updated") return
        if (event.location && event.location.directory !== props.directory) return
        void config.refetch()
      }),
    [props.server, props.directory],
  )
  const configured = configuredLanguageServers(config.isPending || config.isError ? [] : (config.data ?? []))
  const empty = !config.isPending && !config.isError && configured.servers.length === 0
  const title = empty
    ? configured.disabled
      ? "project.settings.extensions.lsp.disabled.title"
      : "project.settings.extensions.lsp.empty.title"
    : "project.settings.extensions.lsp.configured"
  return (
    <div className="project-settings-extension-section">
      <div className="project-settings-extension-section-header">
        <div className="project-settings-extension-section-copy">
          <span>{i18n.t(title)}</span>
          {empty && (
            <span className="project-settings-extension-empty-description">
              {i18n.t(
                configured.disabled
                  ? "project.settings.extensions.lsp.disabled.description"
                  : "project.settings.extensions.lsp.empty.description",
              )}
            </span>
          )}
        </div>
        <span>{i18n.t("project.settings.extensions.lsp.description")}</span>
      </div>
      {config.isPending && <p className="project-settings-extension-empty-description">{i18n.t("common.loading")}</p>}
      {config.isError && (
        <div className="project-settings-extension-section-copy" role="status">
          <span className="project-settings-extension-empty-description">
            {i18n.t("project.settings.extensions.lsp.loadFailed")}
          </span>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void config.refetch()}>
            {i18n.t("project.settings.extensions.lsp.retry")}
          </Button>
        </div>
      )}
      {configured.servers.length > 0 && (
        <Panel data-component="settings-list" data-variant="catalog">
          {configured.servers.map((item) => (
            <ExtensionRow
              key={item.name}
              icon={<Code aria-hidden />}
              name={item.name}
              description={item.extensions.length ? <bdi dir="ltr">{item.extensions.join(", ")}</bdi> : undefined}
            >
              <span className="project-settings-extension-row-status">
                {i18n.t(
                  item.disabled
                    ? "project.settings.extensions.lsp.status.disabled"
                    : "project.settings.extensions.lsp.status.enabled",
                )}
              </span>
            </ExtensionRow>
          ))}
        </Panel>
      )}
    </div>
  )
}
