// Публичные ссылки Buff Code (#816): запись у машины, индекс у шлюза; зритель получает документ
// по правилам ссылки; удаление источника кончает ссылку; без шлюза ссылка не создаётся.
import { describe, expect, test } from "bun:test"
import { mkdtemp, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RefusalError, SHARE_FILE, SHARE_VIEW, type ShareDocument, type ShareFileChunk } from "@buff/mobile-protocol"
import { buildDocument, fileChunk, sentFile, type StoredMessage } from "../../src/buff/share/document"
import { ShareLinks, type LinkPorts } from "../../src/buff/share/links"
import {
  fileShareStore,
  hashPassword,
  memShareStore,
  verifyPassword,
  type ShareRecord,
} from "../../src/buff/share/store"

const ID = "S".repeat(22)
const png = Buffer.alloc(100 * 1024, 7).toString("base64")
const messages: StoredMessage[] = [
  {
    id: "u1",
    type: "user",
    text: "Покажи файл",
    files: [{ data: png, mime: "image/png", name: "shot.png" }],
    time: { created: 1000 },
  },
  {
    id: "a1",
    type: "assistant",
    time: { created: 2000 },
    content: [
      { type: "reasoning", text: "думаю" },
      {
        type: "tool",
        id: "t1",
        name: "read",
        state: { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "const a = 1" }] },
      },
      { type: "text", text: "Вот файл." },
    ],
  },
  { id: "c1", type: "compaction", description: "Контекст сжат", time: { created: 2500 } },
  { id: "u2", type: "user", text: "Спасибо", time: { created: 3000 } },
  {
    id: "a2",
    type: "assistant",
    time: { created: 4000 },
    content: [
      { type: "tool", id: "t2", name: "bash", state: { status: "error", input: "ls", error: { message: "boom" } } },
    ],
  },
]

// #892: what the window and the phone show as cards and lines of their own.
const handed: StoredMessage[] = [
  {
    id: "a9",
    type: "assistant",
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "t9",
        name: "send_file",
        state: {
          status: "completed",
          input: { path: "/work/out/TEXT.md", note: "Готовый текст" },
          content: [{ type: "text", text: "Sent to the user: out/TEXT.md" }],
          metadata: {
            sent: { file: "out/TEXT.md", name: "TEXT.md", mime: "text/markdown", bytes: 2048, note: "Готовый текст" },
          },
        },
      },
      { type: "text", text: "Файл готов." },
    ],
  },
  {
    id: "g1",
    type: "synthetic",
    description: "Цель достигнута",
    metadata: { source: "buff-goal", summary: "Тесты зелёные" },
    time: { created: 2 },
  },
  { id: "y1", type: "synthetic", description: "Shell output", metadata: { source: "shell" }, time: { created: 3 } },
  { id: "a10", type: "assistant", time: { created: 4 }, content: [], error: { message: "Модель недоступна" } },
]
const handedMessages = handed

const record = (over: Partial<ShareRecord> = {}): ShareRecord => ({
  id: ID,
  session: "s1",
  messages: [],
  title: "Моя ссылка",
  pass: null,
  expiresAt: null,
  tools: false,
  live: false,
  enabled: true,
  created: 5,
  published: true,
  ...over,
})

describe("store", () => {
  test("passwords are kept as scrypt hashes with a salt, never in the clear", () => {
    const stored = hashPassword("секрет")
    expect(stored.hash).not.toContain("секрет")
    expect(verifyPassword(stored, "секрет")).toBe(true)
    expect(verifyPassword(stored, "Секрет")).toBe(false)
    expect(hashPassword("секрет").salt).not.toBe(stored.salt)
  })

  test("the file store is the owner's only and round-trips records", async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "share-")), "share")
    const store = fileShareStore(dir)
    await store.save(record())
    expect((await stat(path.join(dir, "links.json"))).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await fileShareStore(dir).get(ID))?.title).toBe("Моя ссылка")
    await store.remove(ID)
    expect(await store.list()).toEqual([])
  })
})

describe("document", () => {
  test("a whole session: text and files; tools and reasoning only when the link shows them", () => {
    const plain = buildDocument(record(), messages, { limit: 50 }, "Сессия")
    expect(plain.kind).toBe("session")
    expect(plain.title).toBe("Моя ссылка")
    expect(plain.items.map((i) => i.id)).toEqual(["u1", "a1", "c1", "u2"])
    expect(plain.items[0]!.parts).toEqual([
      { kind: "text", text: "Покажи файл" },
      { kind: "file", file: { id: "u1:0", name: "shot.png", mime: "image/png", size: 100 * 1024 } },
    ])
    expect(plain.items[1]!.parts).toEqual([{ kind: "text", text: "Вот файл." }])
    expect(plain.items[2]!.role).toBe("system")
    const withTools = buildDocument(record({ tools: true }), messages, { limit: 50 }, "Сессия")
    expect(withTools.items[1]!.parts.map((p) => p.kind)).toEqual(["reasoning", "tool", "text"])
    expect(withTools.items[1]!.parts[1]).toEqual({
      kind: "tool",
      name: "read",
      title: "read",
      status: "done",
      input: '{\n  "path": "a.ts"\n}',
      output: "const a = 1",
    })
    expect(withTools.items.at(-1)!.parts[0]).toEqual({
      kind: "tool",
      name: "bash",
      title: "bash",
      status: "error",
      input: "ls",
      output: "boom",
    })
  })

  test("a subagent call names its own session (#893); other calls and a call without one do not", () => {
    const call = (id: string, name: string, metadata?: Record<string, unknown>): StoredMessage => ({
      id,
      type: "assistant",
      time: { created: 1 },
      content: [
        {
          type: "tool",
          id: `t-${id}`,
          name,
          state: { status: "completed", input: { description: "Тесты" }, ...(metadata ? { metadata } : {}) },
        },
      ],
    })
    const doc = buildDocument(
      record({ tools: true }),
      [
        call("a", "subagent", { sessionID: "ses_child" }),
        call("b", "subagent"),
        call("c", "bash", { sessionID: "ses_x" }),
      ],
      { limit: 50 },
      "Сессия",
    )
    expect(doc.items.map((i) => (i.parts[0] as { session?: string }).session)).toEqual([
      "ses_child",
      undefined,
      undefined,
    ])
  })

  test("a file the agent handed over is a file of the document — with its note, whether tools show or not (#892)", () => {
    for (const tools of [false, true]) {
      const doc = buildDocument(record({ tools }), handed, { limit: 50 }, "Сессия")
      expect(doc.items[0]!.parts).toEqual([
        {
          kind: "file",
          file: { id: "a9:s0", name: "TEXT.md", mime: "text/markdown", size: 2048 },
          note: "Готовый текст",
        },
        { kind: "text", text: "Файл готов." },
      ])
    }
  })

  test("a goal or workflow notice and a failed turn are lines of the document; other service records are not (#892)", () => {
    const doc = buildDocument(record(), handed, { limit: 50 }, "Сессия")
    expect(doc.items.map((i) => [i.id, i.role])).toEqual([
      ["a9", "assistant"],
      ["g1", "system"],
      ["a10", "assistant"],
    ])
    expect(doc.items[1]!.parts).toEqual([{ kind: "notice", label: "Цель достигнута", summary: "Тесты зелёные" }])
    expect(doc.items[2]!.parts).toEqual([{ kind: "notice", label: "Модель недоступна", tone: "error" }])
  })

  test("a handed file is found by its id for reading; a message outside the selection has none (#892)", () => {
    expect(sentFile(record(), handed, "a9:s0")).toEqual({
      path: "out/TEXT.md",
      name: "TEXT.md",
      mime: "text/markdown",
      size: 2048,
    })
    expect(sentFile(record({ messages: ["g1"] }), handed, "a9:s0")).toBeNull()
    expect(sentFile(record(), handed, "a9:s1")).toBeNull()
    expect(sentFile(record(), handed, "a9:0")).toBeNull()
  })

  test("selected messages only, in session order; the session title stands in for an empty one", () => {
    const doc = buildDocument(record({ messages: ["u2", "a1"], title: "" }), messages, { limit: 50 }, "Сессия")
    expect(doc.kind).toBe("messages")
    expect(doc.title).toBe("Сессия")
    expect(doc.items.map((i) => i.id)).toEqual(["a1", "u2"])
  })

  test("pages follow limit/after/next", () => {
    const first = buildDocument(record(), messages, { limit: 2 }, "")
    expect(first.items.map((i) => i.id)).toEqual(["u1", "a1"])
    expect(first.next).toBe("a1")
    const second = buildDocument(record(), messages, { after: "a1", limit: 2 }, "")
    expect(second.items.map((i) => i.id)).toEqual(["c1", "u2"])
    expect(second.next).toBeNull()
  })

  test("a file comes in chunks from its message; a message outside the selection has no files", () => {
    const first = fileChunk(record(), messages, "u1:0", 0)!
    expect(first.file.name).toBe("shot.png")
    expect(first.next).toBe(96 * 1024)
    const rest = fileChunk(record(), messages, "u1:0", first.next!)!
    expect(rest.next).toBeNull()
    expect(Buffer.from(first.data, "base64").length + Buffer.from(rest.data, "base64").length).toBe(100 * 1024)
    expect(fileChunk(record({ messages: ["a1"] }), messages, "u1:0", 0)).toBeNull()
    expect(fileChunk(record(), messages, "u1:9", 0)).toBeNull()
    expect(fileChunk(record(), messages, "nope", 0)).toBeNull()
  })
})

describe("links", () => {
  function rig(over: Partial<LinkPorts> = {}) {
    const gateway: { published: Record<string, number | null>; revoked: string[]; up: boolean } = {
      published: {},
      revoked: [],
      up: true,
    }
    const sessions = new Map<string, { title: string; active?: boolean; parent?: string }>([
      ["s1", { title: "Сессия" }],
    ])
    let now = 10_000
    const ports: LinkPorts = {
      store: memShareStore(),
      gatewayHost: "dev.buff.systems",
      async publish(id, expiresAt) {
        if (!gateway.up) return false
        gateway.published[id] = expiresAt
        return true
      },
      async revoke(id) {
        if (!gateway.up) return false
        gateway.revoked.push(id)
        delete gateway.published[id]
        return true
      },
      async session(id) {
        return sessions.get(id) ?? null
      },
      async messages() {
        return messages
      },
      now: () => now,
      newId: () => ID,
      ...over,
    }
    return { links: new ShareLinks(ports), ports, gateway, sessions, tick: (ms: number) => (now += ms) }
  }

  test("a link is published at the gateway and shown with its address; without the gateway none is made", async () => {
    const r = rig()
    const made = await r.links.create({
      session: "s1",
      title: "  Разбор  ",
      pass: "pw",
      expiresAt: 20_000,
      tools: true,
    })
    expect(made).toMatchObject({
      id: ID,
      link: `https://dev.buff.systems/share/${ID}`,
      title: "Разбор",
      hasPass: true,
      expiresAt: 20_000,
      tools: true,
      kind: "session",
      published: true,
    })
    expect(r.gateway.published).toEqual({ [ID]: 20_000 })
    expect((await r.links.list()).length).toBe(1)
    await expect(r.links.create({ session: "s1", title: "   " })).rejects.toBeInstanceOf(RefusalError)
    await expect(r.links.create({ session: "nope", title: "x" })).rejects.toBeInstanceOf(RefusalError)
    r.gateway.up = false
    await expect(r.links.create({ session: "s1", title: "x" })).rejects.toThrow(/dev.buff.systems/)
    expect((await r.links.list()).length).toBe(1)
  })

  test("the viewer gets the document by the link's rules: password, expiry, switched off, removed", async () => {
    const r = rig()
    await r.links.create({ session: "s1", title: "Разбор", pass: "pw", expiresAt: 20_000 })
    expect(await r.links.serve(SHARE_VIEW, { id: ID })).toEqual({ ok: true, refused: "password" })
    expect(await r.links.serve(SHARE_VIEW, { id: ID, pass: "wrong" })).toEqual({ ok: true, refused: "password" })
    const ok = await r.links.serve(SHARE_VIEW, { id: ID, pass: "pw", limit: 2 })
    const doc = ok.document as ShareDocument
    expect(doc.title).toBe("Разбор")
    expect(doc.active).toBeUndefined()
    // A live link (#823): the tail, and whether the session is being worked on.
    r.sessions.set("s1", { title: "Сессия", active: true })
    await r.links.update(ID, { live: true })
    const live = (await r.links.serve(SHARE_VIEW, { id: ID, pass: "pw", limit: 1, tail: true }))
      .document as ShareDocument
    expect(live.items.map((i) => i.id)).toEqual(["u2"])
    expect(live.active).toBe(true)
    await r.links.update(ID, { live: false })
    expect(doc.items.length).toBe(2)
    expect(doc.next).toBe("a1")
    const chunk = await r.links.serve(SHARE_FILE, { id: ID, pass: "pw", file: "u1:0" })
    expect((chunk.chunk as { next: number }).next).toBe(96 * 1024)
    await expect(r.links.serve(SHARE_FILE, { id: ID, pass: "pw", file: "u1:5" })).rejects.toBeInstanceOf(RefusalError)
    await r.links.update(ID, { enabled: false })
    expect(await r.links.serve(SHARE_VIEW, { id: ID, pass: "pw" })).toEqual({ ok: true, refused: "disabled" })
    await r.links.update(ID, { enabled: true, pass: null })
    expect((await r.links.serve(SHARE_VIEW, { id: ID })).document).toBeDefined()
    r.tick(20_000)
    expect(await r.links.serve(SHARE_VIEW, { id: ID })).toEqual({ ok: true, refused: "expired" })
    await r.links.update(ID, { expiresAt: null })
    expect(r.gateway.published[ID]).toBeNull()
    expect((await r.links.serve(SHARE_VIEW, { id: ID })).document).toBeDefined()
    await r.links.remove(ID)
    expect(r.gateway.revoked).toEqual([ID])
    expect(await r.links.serve(SHARE_VIEW, { id: ID })).toEqual({ ok: true, refused: "missing" })
    await expect(r.links.serve(SHARE_VIEW, { id: "bad" })).rejects.toBeInstanceOf(RefusalError)
    await expect(r.links.serve("session.prompt", {})).rejects.toBeInstanceOf(RefusalError)
    await expect(r.links.serve(SHARE_VIEW, { id: ID, limit: -1 })).rejects.toBeInstanceOf(RefusalError)
  })

  // #893: a subagent's own session reads through the link of its parent — whole sessions with tools only.
  test("a subagent's session is read with `sub`: a descendant of the shared session, while the link shows tools", async () => {
    const child: StoredMessage[] = [
      { id: "cu", type: "user", text: "Напиши тесты", time: { created: 1 } },
      { id: "ca", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "Готово" }] },
    ]
    const r = rig({ messages: async (session) => (session === "s1" ? messages : child) })
    r.sessions.set("child", { title: "Тесты округления", parent: "s1" })
    r.sessions.set("grandchild", { title: "Внук", parent: "child" })
    r.sessions.set("stranger", { title: "Чужая" })
    await r.links.create({ session: "s1", title: "Разбор", tools: true })
    const doc = (await r.links.serve(SHARE_VIEW, { id: ID, sub: "child" })).document as ShareDocument
    expect(doc.title).toBe("Тесты округления")
    expect(doc.kind).toBe("session")
    expect(doc.sub).toBe("child")
    expect(((await r.links.serve(SHARE_VIEW, { id: ID })).document as ShareDocument).sub).toBeUndefined()
    expect(doc.items.map((i) => i.id)).toEqual(["cu", "ca"])
    expect(((await r.links.serve(SHARE_VIEW, { id: ID, sub: "grandchild" })).document as ShareDocument).title).toBe(
      "Внук",
    )
    // Not of this session, unknown, or the session itself — there is no such page.
    for (const sub of ["stranger", "nope", "s1"])
      expect(await r.links.serve(SHARE_VIEW, { id: ID, sub })).toEqual({ ok: true, refused: "missing" })
    // The link's rules stand: without tools the subagents are not shown at all.
    await r.links.update(ID, { tools: false })
    expect(await r.links.serve(SHARE_VIEW, { id: ID, sub: "child" })).toEqual({ ok: true, refused: "missing" })
  })

  test("a handed file is read from the session's folder in chunks; a file that is gone is refused (#892)", async () => {
    const bytes = Buffer.alloc(100 * 1024, 5)
    const asked: [string, string][] = []
    const r = rig({
      messages: async () => handedMessages,
      read: async (session, file) => (
        asked.push([session, file]),
        file === "out/TEXT.md" ? new Uint8Array(bytes) : null
      ),
    })
    await r.links.create({ session: "s1", title: "Разбор" })
    const first = (await r.links.serve(SHARE_FILE, { id: ID, file: "a9:s0" })).chunk as ShareFileChunk
    expect(first.file).toEqual({ id: "a9:s0", name: "TEXT.md", mime: "text/markdown", size: 100 * 1024 })
    expect(first.next).toBe(96 * 1024)
    const rest = (await r.links.serve(SHARE_FILE, { id: ID, file: "a9:s0", from: first.next! })).chunk as ShareFileChunk
    expect(rest.next).toBeNull()
    expect(Buffer.from(first.data, "base64").length + Buffer.from(rest.data, "base64").length).toBe(100 * 1024)
    expect(asked[0]).toEqual(["s1", "out/TEXT.md"])
    await expect(r.links.serve(SHARE_FILE, { id: ID, file: "a9:s1" })).rejects.toBeInstanceOf(RefusalError)
    const gone = rig({ messages: async () => handedMessages, read: async () => null })
    await gone.links.create({ session: "s1", title: "Разбор" })
    await expect(gone.links.serve(SHARE_FILE, { id: ID, file: "a9:s0" })).rejects.toBeInstanceOf(RefusalError)
  })

  test("a link of selected messages does not open subagents' sessions", async () => {
    const r = rig()
    r.sessions.set("child", { title: "Тесты", parent: "s1" })
    await r.links.create({ session: "s1", title: "Выбранное", messages: ["u1", "a1"], tools: true })
    expect(await r.links.serve(SHARE_VIEW, { id: ID, sub: "child" })).toEqual({ ok: true, refused: "missing" })
  })

  test("a deleted source ends its links; a revocation the gateway missed waits and is retried", async () => {
    const r = rig()
    await r.links.create({ session: "s1", title: "Разбор" })
    r.gateway.up = false
    expect(await r.links.sourceDeleted("s1")).toBe(1)
    expect(await r.links.list()).toEqual([])
    expect(await r.links.serve(SHARE_VIEW, { id: ID })).toEqual({ ok: true, refused: "deleted" })
    expect(await r.links.pending()).toBe(true)
    r.gateway.up = true
    await r.links.sync()
    expect(r.gateway.revoked).toEqual([ID])
    expect(await r.links.pending()).toBe(false)
    expect(await r.links.serve(SHARE_VIEW, { id: ID })).toEqual({ ok: true, refused: "missing" })
  })

  test("a source that vanished without a word reads as deleted the moment it is asked for", async () => {
    const r = rig()
    await r.links.create({ session: "s1", title: "Разбор" })
    r.sessions.delete("s1")
    expect(await r.links.serve(SHARE_VIEW, { id: ID })).toEqual({ ok: true, refused: "deleted" })
    expect(r.gateway.revoked).toEqual([ID])
  })

  test("a new expiry the gateway did not hear is published at the next sync", async () => {
    const r = rig()
    await r.links.create({ session: "s1", title: "Разбор" })
    r.gateway.up = false
    const changed = await r.links.update(ID, { expiresAt: 50_000 })
    expect(changed.published).toBe(false)
    r.gateway.up = true
    await r.links.sync()
    expect(r.gateway.published[ID]).toBe(50_000)
    expect((await r.links.list())[0]!.published).toBe(true)
  })
})

describe("phone", () => {
  test("the phone's shares.* commands map onto the same actions", async () => {
    const { phoneCommand } = await import("../../src/buff/share/phone")
    const gateway = { up: true }
    const links = new ShareLinks({
      store: memShareStore(),
      gatewayHost: "dev.buff.systems",
      publish: async () => gateway.up,
      revoke: async () => gateway.up,
      session: async () => ({ title: "Сессия" }),
      messages: async () => messages,
      now: () => 1,
      newId: () => ID,
    })
    const made = await phoneCommand(links, "shares.create", { session: "s1", title: "С телефона", tools: true })
    expect((made.link as { id: string }).id).toBe(ID)
    expect(((await phoneCommand(links, "shares.list", {})).links as unknown[]).length).toBe(1)
    const changed = await phoneCommand(links, "shares.update", { id: ID, enabled: false, pass: "x" })
    expect(changed.link).toMatchObject({ enabled: false, hasPass: true })
    await expect(phoneCommand(links, "shares.update", {})).rejects.toBeInstanceOf(RefusalError)
    await expect(phoneCommand(links, "shares.other", {})).rejects.toBeInstanceOf(RefusalError)
    expect(await phoneCommand(links, "shares.remove", { id: ID })).toEqual({ ok: true })
    expect(await links.list()).toEqual([])
  })
})
