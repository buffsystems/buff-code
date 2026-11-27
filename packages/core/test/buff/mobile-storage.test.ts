// Web client (#969): the person's storage on a cloud machine — the machine's home, listed, read,
// written and tidied from the client — and the results: files the agent handed over. The disk is a
// real temporary home; the fake `Call` stands for the Buff Code server.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"
import { changeable, insideHome } from "../../src/buff/mobile/api-storage"

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

async function rig(options: { cloud?: boolean; uploadMaxBytes?: number; artifacts?: (home: string) => unknown[] } = {}) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), "mobile-storage-")))
  await mkdir(path.join(home, "projects", "shop"), { recursive: true })
  await mkdir(path.join(home, "pictures"))
  await mkdir(path.join(home, "lost+found"))
  await mkdir(path.join(home, ".config", "buff"), { recursive: true })
  await writeFile(path.join(home, "notes.txt"), "привет")
  await writeFile(path.join(home, "pictures", "cat.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))
  await writeFile(path.join(home, "projects", "shop", "menu.md"), "# Menu")
  await writeFile(path.join(home, ".config", "buff", "AGENTS.md"), "rules")
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const call: Call = async (method, route, o) => {
    calls.push({ method, path: route, body: o?.body })
    if (route === "/api/location") return { directory: home, project: { id: "home", directory: home, canonical: home } }
    if (route === "/api/project")
      return [
        { id: "home", canonical: home, time: { updated: 1 } },
        { id: "p1", canonical: path.join(home, "projects", "shop"), name: "Shop", time: { updated: 2 } },
      ]
    if (route === "/api/session/s1") return { data: { id: "s1", location: { directory: path.join(home, "projects", "shop") } } }
    if (route === "/api/rpc/buff.artifacts/list") return { output: { items: options.artifacts?.(home) ?? [], next: 2 } }
    return { data: {} }
  }
  const limits = { uploadMaxBytes: options.uploadMaxBytes ?? 1000, memoryMaxChars: 500, mcpServersMax: 3 }
  const api = mobileApi(call, undefined, { machine: { home, cloud: options.cloud ?? true, limits } })
  const run = (op: string, args: Record<string, unknown> = {}) =>
    api.run(record, op, { lang: "en", ...args }) as Promise<Record<string, unknown>>
  const upload = (id: string, bytes: Buffer, name = "f.bin") =>
    run("attachment_upload", { id, seq: 0, of: 1, name, mime: "application/octet-stream", data: bytes.toString("base64") })
  return { home, calls, run, upload }
}

describe("the path rule", () => {
  test("a path stays inside the home: relative or absolute, never above it", () => {
    expect(insideHome("/home/user", "")).toBe("/home/user")
    expect(insideHome("/home/user", "a/b.txt")).toBe("/home/user/a/b.txt")
    expect(insideHome("/home/user", "/home/user/pictures/cat.png")).toBe("/home/user/pictures/cat.png")
    expect(insideHome("/home/user", "a/../b")).toBe("/home/user/b")
    for (const out of ["..", "../x", "a/../../x", "/etc/passwd", "/home/user2/x", "/home/user/../x", "a\0b"])
      expect(insideHome("/home/user", out)).toBeUndefined()
  })

  test("settings and the transcript store are read-only from here; so is the home itself", () => {
    expect(changeable("/home/user", "/home/user/projects/a")).toBe(true)
    expect(changeable("/home/user", "/home/user")).toBe(false)
    expect(changeable("/home/user", "/home/user/.config/buff/x")).toBe(false)
    expect(changeable("/home/user", "/home/user/.local")).toBe(false)
    expect(changeable("/home/user", "/home/user/.cache/x")).toBe(true)
  })
})

describe("storage", () => {
  test("list: folders first, hidden entries on request, size and time of each", async () => {
    const r = await rig()
    const listed = (await r.run("storage.list", { path: "" })) as { entries: { name: string; type: string; size: number; modified: number }[] }
    expect(listed.entries.map((e) => [e.name, e.type, e.size])).toEqual([
      ["pictures", "directory", 0],
      ["projects", "directory", 0],
      ["notes.txt", "file", 12],
    ])
    expect(listed.entries[2]!.modified).toBeGreaterThan(1_600_000_000_000)
    const all = (await r.run("storage.list", { path: "", hidden: true })) as { entries: { name: string }[] }
    expect(all.entries.map((e) => e.name)).toContain(".config")
    await expect(r.run("storage.list", { path: "nope" })).rejects.toThrow("No such folder")
  })

  test("read: text as text, a picture as base64, in parts — by a relative or an absolute path", async () => {
    const r = await rig()
    expect(await r.run("storage.read", { path: "notes.txt" })).toEqual({
      ok: true,
      path: "notes.txt",
      mime: "text/plain",
      size: 12,
      from: 0,
      text: "привет",
    })
    const picture = await r.run("storage.read", { path: path.join(r.home, "pictures", "cat.png") })
    expect(picture).toMatchObject({ path: "pictures/cat.png", mime: "image/png", size: 7, base64: "iVBORwABAg==" })
    expect(await r.run("storage.read", { path: "notes.txt", raw: true })).toMatchObject({ base64: Buffer.from("привет").toString("base64") })
    expect(await r.run("storage.read", { path: ".config/buff/AGENTS.md" })).toMatchObject({ text: "rules" })
    await expect(r.run("storage.read", { path: "projects" })).rejects.toThrow("No such file")
  })

  test("nothing outside the home is reachable — by dots, by an absolute path or through a link", async () => {
    const r = await rig()
    await symlink("/etc", path.join(r.home, "leak"))
    for (const out of ["../x", "/etc/hostname", "leak/hostname"]) {
      await expect(r.run("storage.read", { path: out })).rejects.toThrow("Only inside your storage")
      await expect(r.run("storage.mkdir", { path: `${out}/made` })).rejects.toThrow("Only inside your storage")
    }
    const listed = (await r.run("storage.list", { path: "" })) as { entries: { name: string }[] }
    expect(listed.entries.map((e) => e.name)).not.toContain("leak")
  })

  test("write takes an uploaded file; mkdir, rename and remove tidy the storage", async () => {
    const r = await rig()
    await r.upload("u1", Buffer.from("hello"))
    expect(await r.run("storage.write", { path: "docs/a.txt", upload_id: "u1" })).toEqual({ ok: true })
    expect(await readFile(path.join(r.home, "docs", "a.txt"), "utf8")).toBe("hello")
    await expect(r.run("storage.write", { path: "docs/b.txt", upload_id: "u1" })).rejects.toThrow(
      "The file did not upload completely — attach it again",
    )
    await r.run("storage.mkdir", { path: "docs/deep/er" })
    await r.run("storage.rename", { path: "docs/a.txt", to: "docs/deep/b.txt" })
    expect(await readFile(path.join(r.home, "docs", "deep", "b.txt"), "utf8")).toBe("hello")
    await expect(r.run("storage.rename", { path: "notes.txt", to: "docs/deep/b.txt" })).rejects.toThrow(
      "A file with this name is already there",
    )
    await r.run("storage.remove", { path: "docs" })
    expect(await stat(path.join(r.home, "docs")).catch(() => null)).toBeNull()
    await expect(r.run("storage.remove", { path: "docs" })).rejects.toThrow("No such file")
  })

  test("settings are not changed from here, and the home is not removed", async () => {
    const r = await rig()
    await r.upload("u1", Buffer.from("x"))
    const refused = "This folder holds settings and cannot be changed here"
    await expect(r.run("storage.write", { path: ".config/buff/AGENTS.md", upload_id: "u1" })).rejects.toThrow(refused)
    await expect(r.run("storage.remove", { path: ".local" })).rejects.toThrow(refused)
    await expect(r.run("storage.remove", { path: "" })).rejects.toThrow(refused)
    await expect(r.run("storage.rename", { path: "notes.txt", to: ".config/x" })).rejects.toThrow(refused)
    expect(await readFile(path.join(r.home, ".config", "buff", "AGENTS.md"), "utf8")).toBe("rules")
  })

  test("an upload larger than the operator's limit is refused with the limit named", async () => {
    const r = await rig({ uploadMaxBytes: 2 * 1024 * 1024 })
    await expect(r.upload("big", Buffer.alloc(2 * 1024 * 1024 + 3))).rejects.toThrow("The file is larger than 2 MB")
    expect(await r.upload("ok", Buffer.alloc(1024))).toEqual({ ok: true })
  })

  // #971: a file far over the limit is refused at its first part — not after the limit has gone up.
  test("a file far over the limit is refused at its first part", async () => {
    const r = await rig({ uploadMaxBytes: 2 * 1024 * 1024 })
    const part = Buffer.alloc(96 * 1024).toString("base64")
    await expect(
      r.run("attachment_upload", { id: "huge", seq: 0, of: 40, name: "deck.pptx", mime: "application/octet-stream", data: part }),
    ).rejects.toThrow("The file is larger than 2 MB")
    // A file that fits goes up part by part as before.
    for (let seq = 0; seq < 3; seq++)
      expect(
        await r.run("attachment_upload", { id: "fits", seq, of: 3, name: "a.bin", mime: "application/octet-stream", data: part }),
      ).toEqual({ ok: true })
  })

  test("a paired computer refuses the storage: there a client stays inside known projects", async () => {
    const r = await rig({ cloud: false })
    for (const op of ["storage.list", "storage.read", "storage.thumb", "storage.write", "storage.mkdir", "storage.remove", "storage.rename", "artifacts.list"])
      await expect(r.run(op, { path: "notes.txt", to: "x", upload_id: "u" })).rejects.toThrow("Available on a cloud machine only")
  })
})

describe("a picture's preview", () => {
  test("a picture comes back small, in one reply, whatever its size", async () => {
    const r = await rig()
    const photon = await import("@silvia-odwyer/photon-node")
    const pixels = new Uint8Array(1600 * 1000 * 4).map((_, i) => (i * 37) % 251)
    const big = Buffer.from(new photon.PhotonImage(pixels, 1600, 1000).get_bytes())
    await writeFile(path.join(r.home, "pictures", "big.png"), big)
    const thumb = await r.run("storage.thumb", { path: path.join(r.home, "pictures", "big.png") })
    expect(String(thumb.mime)).toMatch(/^image\/(png|jpeg)$/)
    const bytes = Buffer.from(String(thumb.base64), "base64")
    expect(bytes.length).toBeLessThan(64 * 1024)
    const small = photon.PhotonImage.new_from_byteslice(bytes)
    expect(Math.max(small.get_width(), small.get_height())).toBeLessThanOrEqual(480)
    expect(small.get_width() / small.get_height()).toBeCloseTo(1.6, 1)
  })

  test("what is not a picture it can read, or not a file, or outside the home, is refused", async () => {
    const r = await rig()
    await expect(r.run("storage.thumb", { path: "notes.txt" })).rejects.toThrow("No preview for this file")
    await expect(r.run("storage.thumb", { path: "pictures/cat.png" })).rejects.toThrow("No preview for this file")
    await expect(r.run("storage.thumb", { path: "projects" })).rejects.toThrow("No such file")
    await expect(r.run("storage.thumb", { path: "/etc/hostname" })).rejects.toThrow("Only inside your storage")
  })
})

describe("a chat's file read from the home", () => {
  test("files.read takes an absolute path under the home on a cloud machine — a drawn picture lies outside the chat's folder", async () => {
    const r = await rig()
    const picture = await r.run("files.read", { session: "s1", path: path.join(r.home, "pictures", "cat.png") })
    expect(picture).toMatchObject({ mime: "image/png", size: 7, base64: "iVBORwABAg==" })
    await expect(r.run("files.read", { session: "s1", path: "/etc/hostname" })).rejects.toThrow("Only inside your storage")
  })
})

describe("results", () => {
  const items = (home: string) => [
    {
      id: "m1:t1",
      sessionID: "s1",
      title: "Menu",
      directory: path.join(home, "projects", "shop"),
      file: "menu.md",
      name: "menu.md",
      mime: "text/markdown",
      bytes: 6,
      note: "Меню",
      time: 9,
    },
    { id: "m2:t2:0", sessionID: "s2", directory: home, file: path.join(home, "pictures", "cat.png"), name: "cat.png", mime: "image/png", bytes: 7, time: 8 },
    { id: "m3:t3", sessionID: "s2", directory: home, file: "gone.txt", name: "gone.txt", mime: "text/plain", bytes: 1, time: 7 },
  ]

  test("each result names its chat, its project and where the file lies; a deleted file is marked", async () => {
    const r = await rig({ artifacts: items })
    expect(await r.run("artifacts.list", { limit: 3 })).toEqual({
      ok: true,
      items: [
        {
          id: "m1:t1",
          session: "s1",
          sessionTitle: "Menu",
          project: "p1",
          path: path.join(r.home, "projects", "shop", "menu.md"),
          name: "menu.md",
          mime: "text/markdown",
          bytes: 6,
          note: "Меню",
          time: 9,
          exists: true,
        },
        {
          id: "m2:t2:0",
          session: "s2",
          sessionTitle: "",
          project: null,
          path: path.join(r.home, "pictures", "cat.png"),
          name: "cat.png",
          mime: "image/png",
          bytes: 7,
          time: 8,
          exists: true,
        },
        {
          id: "m3:t3",
          session: "s2",
          sessionTitle: "",
          project: null,
          path: path.join(r.home, "gone.txt"),
          name: "gone.txt",
          mime: "text/plain",
          bytes: 1,
          time: 7,
          exists: false,
        },
      ],
      cursor: "2",
    })
  })

  test("a picture drawn and then handed over again is one result — the newer record wins", async () => {
    const twice = (home: string) => [
      { id: "m2:t2", sessionID: "s2", directory: home, file: "pictures/cat.png", name: "cat.png", mime: "image/png", bytes: 7, note: "Кот", time: 9 },
      { id: "m1:t1:0", sessionID: "s2", directory: home, file: path.join(home, "pictures", "cat.png"), name: "cat.png", mime: "image/png", bytes: 7, time: 8 },
      { id: "m0:t0:0", sessionID: "s9", directory: home, file: path.join(home, "pictures", "cat.png"), name: "cat.png", mime: "image/png", bytes: 7, time: 7 },
    ]
    const r = await rig({ artifacts: twice })
    const got = (await r.run("artifacts.list", {})) as { items: { id: string; session: string }[] }
    // The same file in another chat is that chat's result.
    expect(got.items.map((item) => [item.id, item.session])).toEqual([
      ["m2:t2", "s2"],
      ["m0:t0:0", "s9"],
    ])
  })

  test("the machine is asked for one project's chats, for chats outside projects, for one chat, from a cursor", async () => {
    const r = await rig({ artifacts: () => [] })
    const asked = () => r.calls.findLast((c) => c.path === "/api/rpc/buff.artifacts/list")?.body as { input: unknown }
    const shop = path.join(r.home, "projects", "shop")
    await r.run("artifacts.list", {})
    expect(asked().input).toEqual({ limit: 50, offset: 0 })
    await r.run("artifacts.list", { project: "p1", limit: 10, cursor: "20" })
    expect(asked().input).toEqual({ directories: [shop], limit: 10, offset: 20 })
    await r.run("artifacts.list", { project: null, session: "s2" })
    expect(asked().input).toEqual({ sessionID: "s2", directories: [r.home], except: [shop], limit: 50, offset: 0 })
    await expect(r.run("artifacts.list", { project: "nope" })).rejects.toThrow("No such project on this machine")
  })
})
