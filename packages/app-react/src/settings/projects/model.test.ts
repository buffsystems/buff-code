import { expect, test } from "bun:test"
import type { Project } from "@opencode/client/promise"
import type { Server } from "../../core/servers"
import { createStore } from "../../core/store"
import { emptyData } from "../../core/data/state"
import { createProjectEditor, type ProjectPatch } from "./model"

const project = {
  id: "proj_1",
  canonical: "/repo/demo",
  name: "Demo",
  icon: { color: "orange" },
  commands: { start: "echo" },
  time: { created: 1, updated: 1 },
} as Project

function fakeServer() {
  const patches: ProjectPatch[] = []
  const waits: (() => void)[] = []
  const state = createStore(emptyData(""))
  const server = {
    data: { state },
    api: () => ({
      project: {
        update: (input: ProjectPatch & { projectID: string }) => {
          const { projectID, ...patch } = input
          patches.push(patch)
          return new Promise<Project>((resolve) =>
            waits.push(() => resolve({ ...project, ...patch, id: projectID } as Project)),
          )
        },
      },
    }),
  } as unknown as Server
  return { server, patches, waits, state }
}

test("reverting during a save queues the revert after it, and the result reaches the data", async () => {
  const fake = fakeServer()
  const editor = createProjectEditor({
    server: fake.server,
    project: { ...project, worktree: "/repo/demo" },
    onError: () => undefined,
  })
  editor.set({ name: "Renamed" })
  editor.saveName()
  editor.set({ name: "Demo" })
  editor.saveName()
  expect(fake.patches).toEqual([])
  await Promise.resolve()
  expect(fake.patches).toEqual([{ name: "Renamed" }])
  fake.waits.shift()?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fake.patches).toEqual([{ name: "Renamed" }, { name: "Demo" }])
  fake.waits.shift()?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(editor.fields.get().saving).toBe(0)
  expect(fake.state.get().project.info.proj_1?.name).toBe("Demo")
})

test("clearing a field sends an explicit empty value; an unchanged one sends nothing", async () => {
  const fake = fakeServer()
  const editor = createProjectEditor({
    server: fake.server,
    project: { ...project, worktree: "/repo/demo" },
    onError: () => undefined,
  })
  editor.saveName()
  editor.set({ startup: "" })
  editor.saveStartup()
  editor.setColor(undefined)
  await Promise.resolve()
  fake.waits.shift()?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fake.patches).toEqual([{ commands: { start: "" } }, { icon: { color: "", override: "" } }])
})
