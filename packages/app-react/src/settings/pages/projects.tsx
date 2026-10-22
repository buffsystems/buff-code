// Projects of a server (#584), ported from the Solid window's workspaces/projects.tsx and
// project-row.tsx: every project the window has open or the server knows; a row opens the
// project's settings, its menu renames it in place or closes it. More than seven get a filter.

import "../projects/projects.css"
import { DropdownMenuItem, DropdownMenuSeparator, InlineInput, Input, Panel } from "@buff/ui/react"
import { getFilename } from "@opencode/util/path"
import { ChevronRight, Search } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useI18n } from "../../i18n/provider"
import { useServerProjects } from "../../react/core"
import { ContextMenu } from "../../shell/menu/context-menu"
import { showToast } from "../../shell/notifications/toast"
import { displayName, type SettingsProject } from "../inventory"
import { SettingsBody, SettingsHeader } from "../kit"
import { storeProject } from "../projects/model"
import { ProjectIcon } from "../projects/project-icon"
import { useSettingsScope } from "../scope"
import { useSettingsProjects } from "../use-inventory"

export function SettingsProjects(props: { onOpenProject: (project: SettingsProject) => void }) {
  const i18n = useI18n()
  const scope = useSettingsScope()
  const projects = useSettingsProjects(scope.server)
  const [filter, setFilter] = useState("")
  const searchable = projects.length > 7
  const query = searchable ? filter.trim().toLowerCase() : ""
  const shown = query ? projects.filter((project) => displayName(project).toLowerCase().includes(query)) : projects

  return (
    <>
      <SettingsHeader title={i18n.t("settings.projects.title")} description={i18n.t("settings.projects.description")}>
        {searchable && (
          <div className="settings-tab-search">
            <Input
              type="search"
              leadingIcon={Search}
              value={filter}
              placeholder={i18n.t("settings.projects.search.placeholder")}
              aria-label={i18n.t("settings.projects.search.placeholder")}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </div>
        )}
      </SettingsHeader>
      <SettingsBody>
        {shown.length === 0 && (
          <div className="settings-status" role="status">
            {query ? i18n.t("settings.search.empty", { query: `"${filter}"` }) : i18n.t("settings.projects.empty")}
          </div>
        )}
        {shown.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            {shown.map((project) => (
              <ProjectRow key={project.worktree} project={project} onOpen={props.onOpenProject} />
            ))}
          </div>
        )}
      </SettingsBody>
    </>
  )
}

function ProjectRow(props: { project: SettingsProject; onOpen: (project: SettingsProject) => void }) {
  const i18n = useI18n()
  const scope = useSettingsScope()
  const open = useServerProjects(scope.server)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const name = displayName(props.project)

  const rename = async (draft: string) => {
    const next = draft.trim()
    if (!next || next === name || !props.project.id || props.project.id === "global") return setEditing(false)
    setSaving(true)
    const value = next === getFilename(props.project.worktree) ? "" : next
    const saved = await scope.server
      .api()
      .project.update({ projectID: props.project.id, name: value })
      .then((project) => {
        storeProject(scope.server, project)
        return true
      })
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
        })
        return false
      })
    setSaving(false)
    if (saved) setEditing(false)
  }

  return (
    <Panel data-component="settings-project-row" className="settings-project-row group">
      {editing ? (
        <div className="settings-project-row-content">
          <RowContent project={props.project}>
            <InlineInput
              autoFocus
              aria-label={i18n.t("common.rename")}
              dir="auto"
              defaultValue={name}
              disabled={saving}
              className="settings-project-row-name w-full"
              onCommit={(value) => void rename(value)}
              onCancel={() => setEditing(false)}
            />
          </RowContent>
        </div>
      ) : (
        <ContextMenu
          content={
            <>
              <DropdownMenuItem onSelect={() => setEditing(true)}>{i18n.t("common.rename")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => open.close(props.project.worktree)}>
                {i18n.t("common.close")}
              </DropdownMenuItem>
            </>
          }
        >
          {(trigger) => (
            <button
              type="button"
              {...trigger}
              aria-label={name}
              className="settings-project-row-content"
              onClick={() => props.onOpen(props.project)}
            >
              <RowContent project={props.project}>
                <bdi className="settings-project-row-name truncate">{name}</bdi>
              </RowContent>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              />
            </button>
          )}
        </ContextMenu>
      )}
    </Panel>
  )
}

function RowContent(props: { project: SettingsProject; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2.5">
      <ProjectIcon
        name={displayName(props.project)}
        color={props.project.icon?.color}
        override={props.project.icon?.override}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        {props.children}
        <bdi dir="ltr" className="ui-hint truncate" title={props.project.worktree}>
          {props.project.worktree}
        </bdi>
      </span>
    </span>
  )
}
