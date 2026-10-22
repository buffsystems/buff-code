// The draft's screen (#584): the wordmark, the composer and the strips around it from the draft
// slots, the project and workspace pickers under it, and «Session details» at the top end. A port
// of the Solid NewSessionView; the composer and the extensions come from other features.

import { IconButton, Panel, Popover, PopoverContent, PopoverTrigger } from "@buff/ui/react"
import { PanelRight } from "lucide-react"
import { Component, Suspense, useState, type ReactNode } from "react"
import { useCommandRegistration } from "../commands/provider"
import { useCore, useServers } from "../react/core"
import { serverKey, type Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import type { DraftTab } from "../shell/tabs/tabs"
import { useTabs } from "../shell/tabs/provider"
import { useSettingsSurface } from "../settings/context"
import { DraftProvider, useDraftValue } from "./context"
import { useDirectoryPicker } from "../shell/directory-picker/picker"
import { ProjectAddButton, ProjectSelector, selectedProject } from "./project-selector"
import type { DraftSlot, DraftSlots } from "./slots"
import { DraftSummary } from "./summary"
import "./summary.css"
import { useDraftProjects } from "./use-projects"
import { useDraftWorkspace } from "./use-workspace"
import { GitStatus, WorkspaceSelector } from "./workspace-selector"

export function NewSessionScreen(props: { draft: DraftTab; server: Server; slots: DraftSlots }) {
  const i18n = useI18n()
  const core = useCore()
  const tabs = useTabs()
  const workspace = useDraftWorkspace({
    server: props.server,
    draft: props.draft,
    tabs,
    scope: core.scope(props.server.key),
  })
  const value = useDraftValue({ draft: props.draft, server: props.server, tabs, workspace })
  const pick = useDirectoryPicker()
  const servers = useServers()
  const projects = useDraftProjects({
    draft: props.draft,
    tabs,
    worktree: workspace.value,
    pick: async (key) => {
      const conn = servers.find((item) => serverKey(item) === key)
      return conn ? (await pick(conn))[0] : undefined
    },
  })
  const project = selectedProject(projects)
  const [projectOpen, setProjectOpen] = useState(false)
  const [summary, setSummary] = useState(false)

  useCommandRegistration("new-session", () => [
    {
      id: "input.focus",
      title: i18n.t("command.input.focus"),
      category: i18n.t("command.category.view"),
      keybind: "ctrl+l",
      onSelect: value.focus.restore,
    },
    {
      id: "project.select",
      title: i18n.t("session.new.project.search"),
      category: i18n.t("command.category.project"),
      keybind: "mod+shift+o",
      disabled: projects.available.length === 0,
      onSelect: () => setProjectOpen(true),
    },
    {
      id: "session.location.cycle",
      title: i18n.t("command.session.location.cycle"),
      category: i18n.t("command.category.workspace"),
      keybind: "mod+alt+l",
      disabled: !workspace.git,
      onSelect: workspace.cycle,
    },
  ])

  // «View all» opens the worktrees in settings: the draft server's page when there are several.
  const settings = useSettingsSurface()
  const workspacePicker = (variant: "inline" | "summary") => (
    <WorkspaceSelector
      variant={variant}
      value={workspace.value}
      projectRoot={workspace.root}
      workspaces={workspace.workspaces}
      branches={workspace.branches}
      branch={workspace.branch}
      onChange={workspace.set}
      onCreate={workspace.create}
      onSearch={workspace.searchBranches}
      onDone={variant === "inline" ? value.focus.restore : undefined}
      onViewAll={() =>
        servers.length > 1 ? settings.openServer(value.draft.server, "workspaces") : settings.open("workspaces")
      }
    />
  )

  return (
    <DraftProvider value={value}>
      <div className="relative flex size-full flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <div className="@container relative flex h-full min-h-0 flex-1 flex-col">
            <Panel
              data-component="new-session"
              data-summary-open={summary}
              className="relative min-h-0 flex-1 overflow-hidden"
            >
              <SlotEntries entries={props.slots.surface} />
              <div
                data-slot="new-session-summary"
                className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-end px-3"
              >
                <SummaryPopover open={summary} onOpenChange={setSummary}>
                  <DraftSummary
                    project={project}
                    git={workspace.git}
                    workspace={workspacePicker("summary")}
                    extensions={<SlotEntries entries={props.slots.summary} />}
                    onChooseProject={() => {
                      setSummary(false)
                      projects.add()
                    }}
                  />
                </SummaryPopover>
              </div>
              <div className="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
                <div data-slot="new-session-content" className="w-full max-w-[880px]">
                  <Wordmark />
                  <div className="mt-8 flex flex-col gap-8">
                    <div>
                      <SlotEntries entries={props.slots["above-composer"]} />
                      <SlotEntries entries={props.slots.composer} />
                    </div>
                    {projects.available.length === 0 && <ProjectAddButton onAdd={() => projects.add()} />}
                    {project && (
                      <div className="flex min-h-7 min-w-0 flex-col items-center justify-center gap-0 text-muted-foreground sm:flex-row">
                        <ProjectSelector
                          controls={projects}
                          open={projectOpen}
                          onOpenChange={setProjectOpen}
                          onDone={value.focus.restore}
                        />
                        <SlotEntries entries={props.slots["project-bar"]} />
                        {workspace.git ? (
                          workspacePicker("inline")
                        ) : (
                          <GitStatus branch={workspace.branch} noGit={!workspace.git} />
                        )}
                        <SlotEntries entries={props.slots["project-bar-end"]} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </DraftProvider>
  )
}

function Wordmark() {
  const i18n = useI18n()
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      className="pointer-events-none mx-auto w-full max-w-[720px] text-center"
    >
      <span className="select-none text-[clamp(2.5rem,8cqw,5.5rem)] font-semibold tracking-tight opacity-[0.16]">
        {i18n.buff.t("Buff Code")}
      </span>
    </div>
  )
}

/** The «Session details» button and its panel: cards on the page's surface, beside the button. */
function SummaryPopover(props: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const i18n = useI18n()
  useCommandRegistration("draft-summary", () => [
    {
      id: "session.summary.toggle",
      title: i18n.t("command.session.summary.toggle"),
      category: i18n.t("command.category.view"),
      onSelect: () => props.onOpenChange(!props.open),
    },
  ])
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          icon={PanelRight}
          size="sm"
          aria-label={i18n.t("session.summary.title")}
          aria-expanded={props.open}
          title={i18n.t("session.summary.tooltip")}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={12}
        collisionPadding={12}
        data-slot="draft-summary"
        aria-label={i18n.t("session.summary.title")}
        className="draft-summary-popover"
        // The composer keeps the focus; the panel is a glance and a few choices.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  )
}

function SlotEntries(props: { entries: DraftSlot[] }) {
  return props.entries.map((entry) => (
    <SlotBoundary key={entry.id}>
      <Suspense>
        <entry.component />
      </Suspense>
    </SlotBoundary>
  ))
}

class SlotBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
