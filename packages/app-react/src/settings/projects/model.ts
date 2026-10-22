// Editing a project in settings (#584), ported from the Solid window's project-model.ts: each
// field autosaves on blur (the colour and the icon at once) through one queue, so the final value
// wins when the person reverts during a save; a field that only went back to the saved value is
// not written. Every write is a PATCH with explicit removal values ("" clears).

import type { Project, ProjectUpdateInput } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import type { Server } from "../../core/servers"
import { createStore } from "../../core/store"

export type ProjectPatch = Pick<ProjectUpdateInput, "name" | "icon" | "commands">

export type ProjectFields = {
  name: string
  color?: string
  iconOverride?: string
  startup: string
  saving: number
}

/** Put a project the server returned into the window's data, as a project.updated event would. */
export function storeProject(server: Server, project: Project) {
  server.data.state.set((state) => ({
    ...state,
    project: { ...state.project, info: { ...state.project.info, [project.id]: project } },
  }))
}

export function createProjectEditor(input: {
  server: Server
  project: {
    id?: string
    worktree: string
    name?: string
    icon?: { color?: string; override?: string }
    commands?: { start?: string }
  }
  onError: (error: unknown) => void
}) {
  const folder = getFilename(input.project.worktree)
  const fields = createStore<ProjectFields>({
    name: input.project.name || folder,
    color: input.project.icon?.color,
    iconOverride: input.project.icon?.override,
    startup: input.project.commands?.start ?? "",
    saving: 0,
  })
  const saved = {
    name: input.project.name ?? "",
    startup: (input.project.commands?.start ?? "").trim(),
    color: input.project.icon?.color,
    iconOverride: input.project.icon?.override,
  }
  const queue = { current: Promise.resolve() }
  const set = (patch: Partial<ProjectFields>) => fields.set((current) => ({ ...current, ...patch }))
  const saving = (delta: number) => fields.set((current) => ({ ...current, saving: current.saving + delta }))

  const persist = (patch: ProjectPatch, complete: () => void) => {
    const projectID = input.project.id
    if (!projectID || projectID === "global") return
    saving(1)
    queue.current = queue.current
      .then(async () => {
        const project = await input.server.api().project.update({ projectID, ...patch })
        storeProject(input.server, project)
      })
      .then(complete)
      .catch(input.onError)
      .finally(() => saving(-1))
  }

  const saveIcon = (color: string | undefined, override: string | undefined) => {
    if (!fields.get().saving && color === saved.color && override === saved.iconOverride) return
    persist({ icon: { color: color ?? "", override: override ?? "" } }, () => {
      saved.color = color
      saved.iconOverride = override
    })
  }

  return {
    fields,
    folder,
    set,
    saveName() {
      const name = fields.get().name.trim()
      const value = name === folder ? "" : name
      // A pending write can change the saved value, so reverting to it must still be queued.
      if (!fields.get().saving && value === saved.name) return
      persist({ name: value }, () => {
        saved.name = value
      })
    },
    saveStartup() {
      const value = fields.get().startup.trim()
      if (!fields.get().saving && value === saved.startup) return
      persist({ commands: { start: value } }, () => {
        saved.startup = value
      })
    },
    setColor(color: string | undefined) {
      set({ color })
      saveIcon(color, fields.get().iconOverride)
    },
    setOverride(override: string) {
      set({ iconOverride: override })
      saveIcon(fields.get().color, override)
    },
  }
}

export type ProjectEditor = ReturnType<typeof createProjectEditor>
