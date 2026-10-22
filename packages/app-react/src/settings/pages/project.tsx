// One project's general settings (#584), ported from the Solid window's workspaces/project.tsx:
// its name, icon and colour, and the script a new worktree runs — each autosaved (./projects/model).

import "../projects/projects.css"
import { avatarColors, Input, Textarea } from "@buff/ui/react"
import { Check, Upload, X } from "lucide-react"
import { useRef, useState, type DragEvent } from "react"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { displayName } from "../inventory"
import { SettingsBody, SettingsHeader, SettingsList, SettingsRow } from "../kit"
import { createProjectEditor } from "../projects/model"
import { ColorSwatch, ProjectIcon, projectColor } from "../projects/project-icon"
import { useSettingsScope } from "../scope"
import { useSettingsServers } from "../use-inventory"
import { serverName } from "../../core/servers"

export function SettingsProjectGeneral(props: { onOpenServer: () => void }) {
  const scope = useSettingsScope()
  const project = scope.project
  if (!project) return null
  return <ProjectGeneral key={project.worktree} onOpenServer={props.onOpenServer} />
}

function ProjectGeneral(props: { onOpenServer: () => void }) {
  const i18n = useI18n()
  const scope = useSettingsScope()
  const servers = useSettingsServers()
  const project = scope.project ?? { worktree: "", expanded: false }
  const [editor] = useState(() =>
    createProjectEditor({
      server: scope.server,
      project,
      onError: (error) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
        }),
    }),
  )
  const fields = useStore(editor.fields, (value) => value)
  const [hover, setHover] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const selected = projectColor(fields.color)

  const read = (picked: File | undefined) => {
    if (!picked?.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") return
      setHover(false)
      editor.setOverride(reader.result)
    }
    reader.readAsDataURL(picked)
  }
  const iconClick = () => {
    if (fields.iconOverride && hover) return editor.setOverride("")
    file.current?.click()
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    read(event.dataTransfer.files[0])
  }

  return (
    <>
      <div className="settings-tab-header">
        <div className="settings-tab-header-row">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="settings-tab-title project-settings-title truncate">
              <bdi dir="auto">{fields.name || displayName(project)}</bdi>
            </h2>
            {servers.length > 1 && (
              <button type="button" className="project-settings-server-link" onClick={props.onOpenServer}>
                <bdi dir="auto">{serverName(scope.conn)}</bdi>
              </button>
            )}
          </div>
        </div>
      </div>
      <SettingsBody className="project-settings-general">
        <div aria-busy={fields.saving > 0}>
          <SettingsList>
            <SettingsRow
              title={i18n.t("project.settings.name.title")}
              description={i18n.t("project.settings.name.description")}
            >
              <div className="project-settings-name">
                <Input
                  data-action="settings-project-name"
                  value={fields.name}
                  placeholder={editor.folder}
                  aria-label={i18n.t("project.settings.name.title")}
                  onChange={(event) => editor.set({ name: event.currentTarget.value })}
                  onBlur={editor.saveName}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title={i18n.t("dialog.project.edit.icon")}
              description={i18n.t("project.settings.icon.description")}
            >
              <button
                data-action="settings-project-icon"
                type="button"
                aria-label={i18n.t("dialog.project.edit.icon.alt")}
                className={dragOver ? "project-settings-icon project-settings-icon--active" : "project-settings-icon"}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={drop}
                onClick={iconClick}
              >
                <ProjectIcon
                  name={fields.name || displayName(project)}
                  color={fields.color}
                  override={fields.iconOverride}
                  size={32}
                />
                <span className="project-settings-icon-overlay" data-visible={hover}>
                  {fields.iconOverride ? <X aria-hidden /> : <Upload aria-hidden />}
                </span>
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => read(event.currentTarget.files?.[0])}
              />
            </SettingsRow>
            {!fields.iconOverride && (
              <SettingsRow
                title={i18n.t("dialog.project.edit.color")}
                description={i18n.t("project.settings.color.description")}
              >
                <div className="project-settings-colors" data-action="settings-project-color">
                  {avatarColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="project-settings-color"
                      aria-label={i18n.t("dialog.project.edit.color.select", { color })}
                      aria-pressed={selected === color}
                      onClick={() => editor.setColor(selected === color ? undefined : color)}
                    >
                      <ColorSwatch color={color} />
                      {selected === color && <Check aria-hidden />}
                    </button>
                  ))}
                </div>
              </SettingsRow>
            )}
            <div className="project-settings-startup">
              <div className="flex flex-col gap-2">
                <span data-slot="settings-row-title">{i18n.t("dialog.project.edit.worktree.startup")}</span>
                <span data-slot="settings-row-description">
                  {i18n.t("project.settings.worktree.startup.description")}
                </span>
              </div>
              <Textarea
                rows={5}
                value={fields.startup}
                placeholder={i18n.t("dialog.project.edit.worktree.startup.placeholder")}
                aria-label={i18n.t("dialog.project.edit.worktree.startup")}
                spellCheck={false}
                onChange={(event) => editor.set({ startup: event.currentTarget.value })}
                onBlur={editor.saveStartup}
              />
              <div className="project-settings-startup-hint ui-note flex flex-col">
                <span>{inlineVariables(i18n.t("project.settings.worktree.startup.hint.base"))}</span>
                <span>{inlineVariables(i18n.t("project.settings.worktree.startup.hint.new"))}</span>
              </div>
            </div>
          </SettingsList>
        </div>
      </SettingsBody>
    </>
  )
}

function inlineVariables(text: string) {
  return text.split(/(\$[A-Z][A-Z0-9_]*)/g).map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      <code key={index} dir="ltr">
        {part}
      </code>
    ),
  )
}
