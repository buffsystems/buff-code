// Web client (#969): instructions (AGENTS.md) and memory notes (MEMORY.md) of the account and of a
// project, as the client reads and changes them. The fake `Call` keeps the memory files the way
// the engine's buff.memory does.
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"

const record: DeviceRecord = { peer: "m", device: "web", dh: "x", display: "Browser", pairId: "P1", created: 1, login: "owner", org: null }
const HOME = "/home/user"
const SHOP = `${HOME}/projects/shop`
const CONFIG = `${HOME}/.config/buff`
const machine = { home: HOME, cloud: true, limits: { uploadMaxBytes: 1000, memoryMaxChars: 40, mcpServersMax: 3 } }

function server() {
  const files = new Map<string, string>([
    [`${CONFIG}/AGENTS.md`, "Отвечай кратко\n"],
    [`${CONFIG}/MEMORY.md`, "- Любит таблицы <!-- id:a1 at:2026-11-20T10:00:00.000Z chat:ses_1 -->\n"],
  ])
  const off = new Set<string>()
  const calls: Array<{ path: string; directory?: unknown; input?: unknown }> = []
  const call: Call = async (method, route, o) => {
    const directory = o?.query?.["location[directory]"] as string | undefined
    const input = (o?.body as { input?: Record<string, any> } | undefined)?.input ?? {}
    if (route.startsWith("/api/rpc/")) calls.push({ path: route, directory, input })
    if (route === "/api/location") return { directory: HOME, project: { id: "home", directory: HOME, canonical: HOME } }
    if (route === "/api/project")
      return [
        { id: "home", canonical: HOME, time: { updated: 1 } },
        { id: "p1", canonical: SHOP, name: "Shop", time: { updated: 2 } },
      ]
    if (route === "/api/session" && method === "GET") return { data: [{ id: "s1" }] }
    if (route === "/api/rpc/buff.memory/list") {
      const inProject = directory !== HOME
      const row = (path: string, scope: string) => ({ path, scope, exists: files.has(path), ...(files.has(path) ? { modified: 77 } : {}), enabled: !off.has(path) })
      return {
        output: {
          enabled: !off.has("*"),
          files: [row(`${CONFIG}/AGENTS.md`, "user"), row(`${directory}/AGENTS.md`, "project")],
          notes: {
            account: { path: `${CONFIG}/MEMORY.md`, enabled: !off.has(`${CONFIG}/MEMORY.md`) },
            ...(inProject ? { project: { path: `${directory}/MEMORY.md`, enabled: !off.has(`${directory}/MEMORY.md`) } } : {}),
          },
        },
      }
    }
    if (route === "/api/rpc/buff.memory/read") return { output: { text: files.get(input.path) ?? "" } }
    if (route === "/api/rpc/buff.memory/write") return void files.set(input.path, input.text), { output: null }
    if (route === "/api/rpc/buff.memory/enable") {
      const key = input.path ?? "*"
      if (input.enabled) off.delete(key)
      else off.add(key)
      return { output: null }
    }
    if (route === "/api/rpc/buff.memory/useAccount") {
      const key = `acc:${directory}`
      if (input.on === false) off.add(key)
      if (input.on === true) off.delete(key)
      return { output: { on: !off.has(key) } }
    }
    return { data: {} }
  }
  const api = mobileApi(call, undefined, { machine })
  const run = (op: string, args: Record<string, unknown> = {}) => api.run(record, op, { lang: "en", ...args }) as Promise<Record<string, any>>
  return { files, off, calls, run }
}

describe("instructions", () => {
  test("the account's and a project's AGENTS.md are read and written — only those two files", async () => {
    const s = server()
    expect(await s.run("instructions.get", { scope: "account" })).toEqual({ ok: true, text: "Отвечай кратко\n", modified: 77 })
    expect(await s.run("instructions.get", { scope: "project", project: "p1" })).toEqual({ ok: true, text: "" })
    expect(await s.run("instructions.set", { scope: "project", project: "p1", text: "Только HTML" })).toEqual({
      ok: true,
      text: "Только HTML",
      modified: 77,
    })
    expect(s.files.get(`${SHOP}/AGENTS.md`)).toBe("Только HTML")
    expect(s.calls.find((c) => c.path.endsWith("/write"))?.directory).toBe(SHOP)
    await expect(s.run("instructions.get", { scope: "project" })).rejects.toThrow("The field project is required")
    await expect(s.run("instructions.get", { scope: "other" })).rejects.toThrow("The scope is account or project")
    await expect(s.run("instructions.set", { scope: "project", project: "nope", text: "x" })).rejects.toThrow(
      "No such project on this machine",
    )
  })
})

describe("memory notes", () => {
  test("list: the account's notes, and a project's with its switches; notes over the machine's limit are marked", async () => {
    const s = server()
    expect(await s.run("memory.list")).toEqual({
      ok: true,
      enabled: true,
      account: { enabled: true, notes: [{ id: "a1", text: "Любит таблицы", at: "2026-11-20T10:00:00.000Z", chat: "ses_1" }] },
    })
    s.files.set(`${SHOP}/MEMORY.md`, "- Цвет бренда оранжевый, а кнопки — тёмно-синие всегда\n- Цены в рублях\n")
    const listed = await s.run("memory.list", { project: "p1" })
    expect(listed.project).toMatchObject({ enabled: true, useAccount: true, over: true })
    expect(listed.project.notes.map((n: { text: string }) => n.text)).toEqual([
      "Цвет бренда оранжевый, а кнопки — тёмно-синие всегда",
      "Цены в рублях",
    ])
    expect("over" in listed.account).toBe(false)
  })

  test("add, edit and remove change the scope's file and answer the notes", async () => {
    const s = server()
    const added = await s.run("memory.note.add", { scope: "project", project: "p1", text: "  Цены в рублях " })
    expect(added.notes).toHaveLength(1)
    expect(added.notes[0]).toMatchObject({ text: "Цены в рублях" })
    expect(added.notes[0].id).toMatch(/^n/)
    expect(s.files.get(`${SHOP}/MEMORY.md`)).toContain("- Цены в рублях <!-- id:")
    const edited = await s.run("memory.note.edit", { scope: "account", id: "a1", text: "Любит списки" })
    expect(edited.notes).toEqual([{ id: "a1", text: "Любит списки", at: "2026-11-20T10:00:00.000Z", chat: "ses_1" }])
    expect((await s.run("memory.note.remove", { scope: "account", id: "a1" })).notes).toEqual([])
    expect(s.files.get(`${CONFIG}/MEMORY.md`)).toBe("")
    await expect(s.run("memory.note.remove", { scope: "account", id: "a1" })).rejects.toThrow("No such note")
    await expect(s.run("memory.note.add", { scope: "account", text: " " })).rejects.toThrow("The field text is required")
  })

  test("switches: all memory, one scope's notes, and the account's notes inside a project", async () => {
    const s = server()
    await s.run("memory.enable", { enabled: false })
    expect((await s.run("memory.list")).enabled).toBe(false)
    await s.run("memory.enable", { enabled: true })
    await s.run("memory.enable", { scope: "account", enabled: false })
    expect((await s.run("memory.list")).account.enabled).toBe(false)
    await s.run("memory.enable", { scope: "project", project: "p1", enabled: false })
    await s.run("memory.useAccount", { project: "p1", on: false })
    expect((await s.run("memory.list", { project: "p1" })).project).toMatchObject({ enabled: false, useAccount: false })
    expect(s.calls.findLast((c) => c.path.endsWith("/useAccount"))?.directory).toBe(SHOP)
  })
})

describe("the project's home", () => {
  test("project.get tells the instructions and the standing state of memory in one answer", async () => {
    const s = server()
    s.files.set(`${SHOP}/AGENTS.md`, "Только HTML\n")
    s.files.set(`${SHOP}/MEMORY.md`, "- a\n- b\n")
    expect(await s.run("project.get", { project: "p1" })).toEqual({
      ok: true,
      project: { id: "p1", name: "Shop", directory: SHOP },
      chats: 1,
      instructions: { text: "Только HTML\n", modified: 77 },
      memory: { enabled: true, useAccount: true, notes: 2 },
    })
  })
})
