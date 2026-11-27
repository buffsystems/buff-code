// Web client (#969): projects of a cloud machine — a folder under ~/projects for each, made,
// renamed, coloured and removed from the client. The disk is a real temporary home; the fake
// `Call` stands for the Buff Code server.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"

const record: DeviceRecord = {
  peer: "m",
  device: "web",
  dh: "x",
  display: "Browser",
  pairId: "P1",
  created: 1,
  login: "owner",
  org: null,
}
const limits = { uploadMaxBytes: 1000, memoryMaxChars: 500, mcpServersMax: 3 }

async function rig(options: { cloud?: boolean; gitHome?: boolean; active?: string[] } = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "mobile-projects-"))
  const projects = new Map<string, { id: string; canonical: string; name?: string; icon?: { color?: string }; time: { updated: number } }>([
    ["home", { id: "home", canonical: home, time: { updated: 1 } }],
  ])
  const sessions = new Map<string, { id: string; projectID: string; parentID?: string; time: { created: number; updated: number } }>()
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const call: Call = async (method, route, o) => {
    calls.push({ method, path: route, body: o?.body })
    if (route === "/api/location") {
      const directory = String(o?.query?.["location[directory]"])
      if (options.gitHome || directory === home) return { directory, project: { id: "home", directory: home, canonical: home } }
      const id = `p:${path.basename(directory)}`
      if (!projects.has(id)) projects.set(id, { id, canonical: directory, time: { updated: 2 } })
      return { directory, project: { id, directory, canonical: directory } }
    }
    if (route === "/api/project") return [...projects.values()]
    if (route.startsWith("/api/project/")) {
      const id = decodeURIComponent(route.slice("/api/project/".length))
      if (method === "DELETE") return void projects.delete(id)
      const patch = o?.body as { name?: string; icon?: { color?: string } }
      const next = { ...projects.get(id)!, ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.icon ? { icon: patch.icon } : {}) }
      projects.set(id, next)
      return next
    }
    if (route === "/api/session/active") return { data: Object.fromEntries((options.active ?? []).map((id) => [id, {}])) }
    if (route === "/api/session" && method === "GET") {
      const list = [...sessions.values()].filter((s) => s.projectID === o?.query?.project)
      return o?.query?.cursor ? { data: [] } : { data: list, cursor: { next: "end" } }
    }
    const moved = /^\/api\/session\/([^/]+)\/move$/.exec(route)
    if (moved) {
      sessions.get(moved[1]!)!.projectID = "home"
      return undefined
    }
    const one = /^\/api\/session\/([^/]+)$/.exec(route)
    if (one && method === "DELETE") return void sessions.delete(one[1]!)
    return { data: {} }
  }
  const api = mobileApi(call, undefined, { machine: { home, cloud: options.cloud ?? true, limits } })
  return { home, projects, sessions, calls, api }
}

describe("project.create", () => {
  test("makes the folder under ~/projects by a latin name and names the project as the person did", async () => {
    const r = await rig()
    const made = await r.api.run(record, "project.create", { name: "Сайт кофейни", color: "orange" })
    const directory = path.join(r.home, "projects", "sajt-kofejni")
    expect(made).toEqual({ ok: true, project: { id: "p:sajt-kofejni", name: "Сайт кофейни", color: "orange", directory } })
    expect((await stat(directory)).isDirectory()).toBe(true)
    expect(r.projects.get("p:sajt-kofejni")).toMatchObject({ name: "Сайт кофейни", icon: { color: "orange" } })
    // The same name again is another project in a folder of its own.
    const again = (await r.api.run(record, "project.create", { name: "Сайт кофейни" })) as unknown as { project: { directory: string; color?: string } }
    expect(again.project.directory).toBe(`${directory}-2`)
    expect("color" in again.project).toBe(false)
  })

  test("a name is required; a home that is itself a repository cannot hold projects — said in words, nothing left behind", async () => {
    const r = await rig({ gitHome: true })
    await expect(r.api.run(record, "project.create", { name: " ", lang: "en" })).rejects.toThrow("The field name is required")
    await expect(r.api.run(record, "project.create", { name: "Shop", lang: "en" })).rejects.toThrow(
      "A project cannot be made here: the home folder is itself a repository, and every folder inside belongs to it",
    )
    expect(await readdir(path.join(r.home, "projects"))).toEqual([])
  })

  test("only a cloud machine makes and removes folders for a remote client", async () => {
    const r = await rig({ cloud: false })
    await expect(r.api.run(record, "project.create", { name: "Shop", lang: "en" })).rejects.toThrow("Available on a cloud machine only")
    await expect(r.api.run(record, "project.remove", { project: "home", chats: "keep", lang: "en" })).rejects.toThrow(
      "Available on a cloud machine only",
    )
  })
})

describe("project.update and the list", () => {
  test("the name and the colour change; the folder stays; the list tells the colour", async () => {
    const r = await rig()
    await r.api.run(record, "project.create", { name: "Shop" })
    const updated = await r.api.run(record, "project.update", { project: "p:shop", name: "Магазин", color: "blue" })
    expect(updated).toEqual({
      ok: true,
      project: { id: "p:shop", name: "Магазин", color: "blue", directory: path.join(r.home, "projects", "shop") },
    })
    const listed = (await r.api.run(record, "projects.list", {})) as unknown as { projects: { id: string; color?: string }[] }
    expect(listed.projects.find((p) => p.id === "p:shop")?.color).toBe("blue")
    expect("color" in listed.projects.find((p) => p.id === "home")!).toBe(false)
    await expect(r.api.run(record, "project.update", { project: "home", name: "x", lang: "en" })).rejects.toThrow(
      "Chats outside projects are not a project to change",
    )
  })

  test("project.get tells the project and how many chats it holds", async () => {
    const r = await rig()
    await r.api.run(record, "project.create", { name: "Shop" })
    r.sessions.set("s1", { id: "s1", projectID: "p:shop", time: { created: 1, updated: 1 } })
    r.sessions.set("s2", { id: "s2", projectID: "p:shop", parentID: "s1", time: { created: 1, updated: 1 } })
    expect(await r.api.run(record, "project.get", { project: "p:shop" })).toEqual({
      ok: true,
      project: { id: "p:shop", name: "Shop", directory: path.join(r.home, "projects", "shop") },
      chats: 1,
    })
  })
})

describe("project.remove", () => {
  const withChats = async (options: Parameters<typeof rig>[0] = {}) => {
    const r = await rig(options)
    await r.api.run(record, "project.create", { name: "Shop" })
    await writeFile(path.join(r.home, "projects", "shop", "a.txt"), "x")
    r.sessions.set("s1", { id: "s1", projectID: "p:shop", time: { created: 1, updated: 1 } })
    r.sessions.set("s2", { id: "s2", projectID: "p:shop", parentID: "s1", time: { created: 1, updated: 1 } })
    return r
  }

  test("«keep» moves the chats out of the project first; the folder and the project go", async () => {
    const r = await withChats()
    expect(await r.api.run(record, "project.remove", { project: "p:shop", chats: "keep" })).toEqual({ ok: true })
    expect([...r.sessions.values()].map((s) => s.projectID)).toEqual(["home", "home"])
    expect(r.calls.find((c) => c.path === "/api/session/s1/move")?.body).toEqual({ directory: r.home })
    expect(r.projects.has("p:shop")).toBe(false)
    expect(await readdir(path.join(r.home, "projects"))).toEqual([])
  })

  test("«delete» removes the chats with the project", async () => {
    const r = await withChats()
    await r.api.run(record, "project.remove", { project: "p:shop", chats: "delete" })
    // The server deletes a chat's helpers with it: only the chat itself is asked for.
    expect(r.calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/api/session/")).map((c) => c.path)).toEqual([
      "/api/session/s1",
    ])
    expect(r.projects.has("p:shop")).toBe(false)
  })

  test("refused: the home, a project outside ~/projects, a missing choice, a working chat — and nothing is touched", async () => {
    const r = await withChats({ active: ["s2"] })
    const outside = path.join(r.home, "elsewhere")
    await mkdir(outside)
    r.projects.set("p:else", { id: "p:else", canonical: outside, time: { updated: 1 } })
    const refused = (args: Record<string, unknown>, words: string) =>
      expect(r.api.run(record, "project.remove", { ...args, lang: "en" })).rejects.toThrow(words)
    await refused({ project: "home", chats: "keep" }, "Chats outside projects are not a project to change")
    await refused({ project: "p:else", chats: "keep" }, "Only a project made here can be removed here")
    await refused({ project: "p:shop" }, "Choose what happens to the project's chats: delete or keep")
    await refused({ project: "p:shop", chats: "keep" }, "The chat is working — wait for it to finish or stop it")
    expect(r.projects.has("p:shop")).toBe(true)
    expect(await readdir(path.join(r.home, "projects", "shop"))).toEqual(["a.txt"])
    expect(r.sessions.get("s1")?.projectID).toBe("p:shop")
  })
})
