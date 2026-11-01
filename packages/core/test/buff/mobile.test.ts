// Телефон для Buff Code (#639): ключ машины — только владельцу и один на все запуски; новая сессия
// с телефона — проект и модель только из списков машины; машина регистрируется на шлюзе без
// лицензии и отключённый телефон теряет пару на шлюзе.
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PromptInput } from "@opencode/schema/prompt-input"
import { mkdtemp, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { b64u, generateIdentity, openPush, RefusalError, type DeviceRecord, type RelayConn, type SealedPush } from "@buff/mobile-protocol"
import { MobileAgent } from "../../src/buff/mobile/agent"
import { mobileApi, BuffMobileText, type Call } from "../../src/buff/mobile/api"
import { fileStore } from "../../src/buff/mobile/store"

const record: DeviceRecord = {
  peer: "m",
  device: "phone",
  dh: "x",
  display: "Pixel",
  pairId: "P1",
  created: 1,
  login: "owner",
  org: null,
}

describe("store", () => {
  test("the key is kept for the owner only and stays the same", async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "mobile")
    const a = await fileStore(dir).identity()
    const b = await fileStore(dir).identity()
    expect(a.id).toBe(b.id)
    expect((await stat(path.join(dir, "identity.json"))).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  test("a revoked phone stays recorded but no longer counts", async () => {
    const store = fileStore(path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "m"))
    await store.saveDevice(record)
    expect((await store.revoke("phone", 5))?.pairId).toBe("P1")
    expect((await store.device("phone"))?.revoked).toBe(5)
    expect(await store.revoke("phone", 6)).toBeNull()
  })
})

describe("api", () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const call: Call = async (method, route, options) => {
    calls.push({ method, path: route, body: options?.body })
    if (route === "/api/project")
      return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
    if (route === "/api/model")
      return { location: {}, data: [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }] }
    if (route === "/api/session" && method === "POST") return { data: { id: "s1" } }
    if (route === "/api/session")
      return {
        data: [
          { id: "a", projectID: "p1", title: "Из окна", time: { created: 1, updated: 3 } },
          { id: "b", projectID: "p1", title: "С телефона", time: { created: 1, updated: 2 }, metadata: { origin: "phone" } },
          { id: "c", parentID: "a", projectID: "p1", time: { created: 1, updated: 2 } },
          { id: "d", projectID: "p1", time: { created: 1, updated: 2, archived: 5 } },
        ],
      }
    if (route === "/api/session/active") return { data: { b: {} } }
    if (route === "/api/session/b/message") return { data: [{ id: "m1", type: "assistant", content: [{ type: "text", text: "x".repeat(5000) }] }] }
    if (route === "/api/session/b/permission") return { data: [{ id: "perm", action: "bash", resources: ["rm -rf build"] }] }
    if (route === "/api/session/b/form") return { data: [] }
    return { data: {} }
  }
  const api = mobileApi(call)

  test("projects and models come from the machine", async () => {
    expect(await api.run(record, "projects.list", {})).toEqual({
      ok: true,
      projects: [{ id: "p1", name: "shop", directory: "/work/shop", updated: 2, sessions: 2 }],
    })
    expect((await api.run(record, "models.list", { project: "p1" })).models).toEqual([
      { id: "anthropic/sonnet", name: "Sonnet", provider: "anthropic" },
    ])
  })

  test("a new session takes a project and a model from the lists only", async () => {
    await expect(api.run(record, "session.new", { project: "/etc", model: "anthropic/sonnet" })).rejects.toBeInstanceOf(
      RefusalError,
    )
    await expect(api.run(record, "session.new", { project: "p1", model: "other/x" })).rejects.toBeInstanceOf(RefusalError)
    calls.length = 0
    expect(
      await api.run(record, "session.new", { project: "p1", model: "anthropic/sonnet", prompt: "Привет", mode: "edit", plan: true }),
    ).toEqual({ ok: true, session: { id: "s1" } })
    const body = calls.find((c) => c.path === "/api/session" && c.method === "POST")?.body as Record<string, unknown>
    expect(body.model).toEqual({ id: "sonnet", providerID: "anthropic" })
    expect(body.location).toEqual({ directory: "/work/shop" })
    expect(body.metadata).toEqual({ origin: "phone", device: "Pixel" })
    expect(body.agent).toBe("plan")
    expect(Array.isArray(body.permissions)).toBe(true)
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/api/session/s1/prompt",
      body: { text: "Привет", metadata: { source: "phone" } },
    })
  })

  test("an empty first snapshot of a fresh directory is asked again until it settles (#739)", async () => {
    let asked = { model: 0, agent: 0 }
    const api = mobileApi(async (method, route) => {
      if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
      if (route === "/api/model") return { data: ++asked.model < 3 ? [] : [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }] }
      if (route === "/api/model/default") return { data: undefined }
      if (route === "/api/agent") return { data: ++asked.agent < 2 ? [] : [{ id: "build", name: "build", mode: "primary", hidden: false }] }
      if (route === "/api/session") return { data: [] }
      return { data: null }
    })
    const record = { peer: "m", device: "phone", dh: "d", display: "Pixel", pairId: "p", created: 1, login: "u", org: null }
    expect((await api.run(record, "models.list", { project: "p1" })).models).toEqual([
      { id: "anthropic/sonnet", name: "Sonnet", provider: "anthropic" },
    ])
    expect(asked.model).toBe(3)
    expect((await api.run(record, "agents.list", { project: "p1" })).agents).toEqual([{ id: "build" }])
    expect(asked.agent).toBe(2)
  })

  describe("a new session starts where the last one left off (#706)", () => {
    const pick = (last: Record<string, unknown> | undefined) =>
      mobileApi(async (method, route) => {
        if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
        if (route === "/api/model")
          return {
            data: [
              { id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" },
              { id: "n", modelID: "flash", providerID: "openrouter", name: "Flash" },
            ],
          }
        if (route === "/api/model/default") return { data: { id: "n", modelID: "flash", providerID: "openrouter", name: "Flash" } }
        if (route === "/api/agent")
          return {
            data: [
              { id: "build", name: "build", mode: "primary", hidden: false, description: "Пишет код" },
              { id: "plan", name: "plan", mode: "primary", hidden: false },
              { id: "review", name: "review", mode: "all", hidden: false },
              { id: "explore", name: "explore", mode: "subagent", hidden: false },
              { id: "title", name: "title", mode: "primary", hidden: true },
            ],
          }
        if (route === "/api/session" && method === "GET")
          return {
            data: [
              { id: "child", parentID: "x", projectID: "p1", model: { id: "gone", providerID: "x" }, time: { created: 1, updated: 9 } },
              ...(last ? [{ id: "last", projectID: "p1", time: { created: 1, updated: 5 }, ...last }] : []),
            ],
          }
        return { data: {} }
      })

    test("the model of the project's last session comes first", async () => {
      const api = pick({ model: { id: "sonnet", providerID: "anthropic" }, agent: "review" })
      expect((await api.run(record, "models.list", { project: "p1" })).default).toBe("anthropic/sonnet")
      expect((await api.run(record, "agents.list", { project: "p1" })).default).toBe("review")
    })

    test("without a last session, or with its model gone, the machine's default", async () => {
      expect((await pick(undefined).run(record, "models.list", { project: "p1" })).default).toBe("openrouter/flash")
      const gone = pick({ model: { id: "old", providerID: "anthropic" }, agent: "plan" })
      expect((await gone.run(record, "models.list", { project: "p1" })).default).toBe("openrouter/flash")
      expect((await gone.run(record, "agents.list", { project: "p1" })).default).toBe("build")
    })

    test("agents: the ones a person starts, without plan (its own mark), subagents and hidden", async () => {
      expect((await pick(undefined).run(record, "agents.list", { project: "p1" })).agents).toEqual([
        { id: "build", description: "Пишет код" },
        { id: "review" },
      ])
    })
  })

  test("a new session takes an agent from the list; the plan mark wins", async () => {
    const sent: Array<Record<string, unknown>> = []
    const api = mobileApi(async (method, route, options) => {
      if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
      if (route === "/api/model") return { data: [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }] }
      if (route === "/api/agent") return { data: [{ id: "review", name: "review", mode: "all", hidden: false }] }
      if (route === "/api/session" && method === "POST") {
        sent.push(options?.body as Record<string, unknown>)
        return { data: { id: "s1" } }
      }
      return { data: {} }
    })
    const base = { project: "p1", model: "anthropic/sonnet" }
    await api.run(record, "session.new", { ...base, agent: "review" })
    await api.run(record, "session.new", { ...base, agent: "review", plan: true })
    await api.run(record, "session.new", base)
    expect(sent.map((b) => b.agent)).toEqual(["review", "plan", undefined])
    await expect(api.run(record, "session.new", { ...base, agent: "explore" })).rejects.toBeInstanceOf(RefusalError)
  })

  test("a project's sessions as the window lists them: no subagents, no archive, where begun, running", async () => {
    expect(await api.run(record, "sessions.list", { project: "p1" })).toEqual({
      ok: true,
      sessions: [
        { id: "a", title: "Из окна", created: 1, updated: 3, origin: "window", running: false },
        { id: "b", title: "С телефона", created: 1, updated: 2, origin: "phone", running: true },
      ],
    })
  })

  test("watching a session answers its state now: running, what waits, the last messages clipped", async () => {
    const watched: string[] = []
    const watchingApi = mobileApi(call, {
      watch: (device, session) => void watched.push(`${device}:${session}`),
      unwatch: () => {},
    })
    const got = (await watchingApi.run(record, "session.watch", { session: "b" })) as Record<string, unknown>
    expect(watched).toEqual(["phone:b"])
    expect(got.running).toBe(true)
    expect(got.permissions).toEqual([{ id: "perm", action: "bash", resources: ["rm -rf build"] }])
    const text = ((got.messages as { content: { text: string }[] }[])[0]!.content[0]!.text)
    expect(text.length).toBeLessThan(4_100)
  })

  // #711: the session's goal rides along with its state, so the phone shows the goal bar.
  test("the state carries the session's goal for the bar", async () => {
    const goal = { text: "Все тесты зелёные", status: "active", iteration: 2, started: 1, updated: 2 }
    const seen: string[] = []
    const withGoal = mobileApi(async (method, route, options) => {
      seen.push(`${method} ${route}`)
      if (route === "/api/session/g") return { data: { location: { directory: "/w" } } }
      if (route === "/api/rpc/buff.goal/get") {
        expect((options?.body as { input?: { session?: string } })?.input?.session).toBe("g")
        return { output: { goal } }
      }
      if (route === "/api/session/active") return { data: {} }
      return { data: [] }
    })
    const got = (await withGoal.run(record, "session.state", { session: "g" })) as Record<string, unknown>
    expect(got.goal).toEqual(goal)
    expect(seen).toContain("POST /api/rpc/buff.goal/get")
    // No goal set: the bar is absent, not an error.
    const noGoal = mobileApi(async (method, route) =>
      route === "/api/session/g" ? { data: { location: { directory: "/w" } } } : route === "/api/rpc/buff.goal/get" ? { output: {} } : { data: [] },
    )
    expect(((await noGoal.run(record, "session.state", { session: "g" })) as Record<string, unknown>).goal).toBeNull()
  })

  test("a file from the phone arrives in chunks and goes into the prompt whole", async () => {
    calls.length = 0
    await api.run(record, "attachment_upload", { id: "u1", seq: 1, of: 2, name: "a.png", mime: "image/png", data: "CD==" })
    await api.run(record, "attachment_upload", { id: "u1", seq: 0, of: 2, name: "a.png", mime: "image/png", data: "AB" })
    await api.run(record, "session.prompt", { session: "s1", text: "смотри", attachments: [{ upload_id: "u1" }] })
    expect(calls.at(-1)?.body).toEqual({
      text: "смотри",
      metadata: { source: "phone" },
      files: [{ uri: "data:image/png;base64,ABCD==", name: "a.png" }],
    })
    // #676: the body is what the prompt endpoint takes — the schema decides, not this fake.
    expect(() => Schema.decodeUnknownSync(Schema.Array(PromptInput.FileAttachment))((calls.at(-1)?.body as { files: unknown }).files)).not.toThrow()
    await expect(api.run(record, "session.prompt", { session: "s1", attachments: [{ upload_id: "u1" }] })).rejects.toBeInstanceOf(
      RefusalError,
    )
  })

  test("files only inside the session's project, read in parts; RPC only from the list", async () => {
    const big = new Uint8Array(200 * 1024).fill(65)
    const filesApi = mobileApi(
      async (method, route) => (route.startsWith("/api/session/") ? { data: { location: { directory: "/work/shop" } } } : call(method, route)),
      undefined,
      { fetch: async () => ({ mime: "text/plain", bytes: big }) },
    )
    await expect(filesApi.run(record, "files.read", { session: "s1", path: "../etc/passwd" })).rejects.toBeInstanceOf(RefusalError)
    const first = (await filesApi.run(record, "files.read", { session: "s1", path: "a.txt" })) as Record<string, unknown>
    expect(first.size).toBe(200 * 1024)
    expect(first.next).toBe(96 * 1024)
    expect((first.text as string).length).toBe(96 * 1024)
    await expect(filesApi.run(record, "rpc", { session: "s1", id: "buff.memory", method: "list" })).rejects.toBeInstanceOf(RefusalError)
    await expect(filesApi.run(record, "rpc", { session: "s1", id: "buff.git", method: "reset" })).rejects.toBeInstanceOf(RefusalError)
  })

  // #708: документ (docx — zip, его тип содержит «xml») — байтами, не текстом; raw — всегда байтами,
  // чтобы телефон собрал большой файл из частей целиком.
  test("a document travels as bytes, and raw always does", async () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    const files = (mime: string, bytes: Uint8Array) =>
      mobileApi(async (_m, route) => (route.startsWith("/api/session/") ? { data: { location: { directory: "/w" } } } : { data: {} }), undefined, {
        fetch: async () => ({ mime, bytes }),
      })
    const zipLike = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x41, 0x42])
    const doc = (await files(docx, zipLike).run(record, "files.read", { session: "s1", path: "a.docx" })) as Record<string, unknown>
    expect(doc.base64).toBe(Buffer.from(zipLike).toString("base64"))
    expect(doc.text).toBeUndefined()
    const text = new TextEncoder().encode("привет")
    const md = files("text/markdown", text)
    expect(((await md.run(record, "files.read", { session: "s1", path: "a.md" })) as Record<string, unknown>).text).toBe("привет")
    const raw = (await md.run(record, "files.read", { session: "s1", path: "a.md", raw: true })) as Record<string, unknown>
    expect(raw.base64).toBe(Buffer.from(text).toString("base64"))
    expect(BuffMobileText.isText("application/json", new Uint8Array([0]))).toBe(true)
    expect(BuffMobileText.isText("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(false)
    expect(BuffMobileText.isText("application/octet-stream", new TextEncoder().encode("plain"))).toBe(true)
  })

  test("what the phone may not do is refused", async () => {
    await expect(api.run(record, "files.write", {})).rejects.toBeInstanceOf(RefusalError)
    await expect(api.run(record, "permission.answer", { session: "s", request: "r", decision: "maybe" })).rejects.toBeInstanceOf(
      RefusalError,
    )
  })
})

/** A gateway in memory: registration, offers, revocations. */
function fakeGateway() {
  const sent: Array<{ subject: string; body: Record<string, unknown> }> = []
  const conn: RelayConn = {
    subscribe: (subject, o) => {
      subs.set(subject, o.callback)
      return { unsubscribe: () => void subs.delete(subject) }
    },
    publish: (subject, data) => {
      const body = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>
      sent.push({ subject, body })
      const answer = subject.startsWith("relay.cmd.register.")
        ? { ok: true, token: "peer-token", exp: 4_600, pairs: [] }
        : { ok: true, pairId: "P2" }
      const reply = subs.get(String(body.reply))
      reply?.(null, { subject: String(body.reply), data: new TextEncoder().encode(JSON.stringify(answer)) })
    },
    close: async () => {},
    closed: () => new Promise(() => {}),
  }
  const subs = new Map<string, Parameters<RelayConn["subscribe"]>[1]["callback"]>()
  return { conn, sent }
}

describe("agent", () => {
  test("a machine registers without a licence, offers pairing and revokes at the gateway", async () => {
    const gw = fakeGateway()
    const store = fileStore(path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "m"))
    const agent = new MobileAgent({
      store,
      connect: async () => gw.conn,
      gatewayHost: "dev.buff.systems",
      display: () => "laptop",
      exec: async () => ({ ok: true }),
      now: () => 1_000,
    })
    await agent.start()
    expect(gw.sent.length).toBe(0) // no phones yet: the machine stays off the gateway

    const view = await agent.offer("code")
    const register = gw.sent.find((s) => s.subject.startsWith("relay.cmd.register."))!
    expect(register.body.kind).toBe("machine")
    expect("license" in register.body).toBe(false)
    expect(view.state).toBe("offered")
    expect(view.link).toContain("dev.buff.systems")
    expect(agent.offers().map((o) => o.offerId)).toEqual([view.offerId])

    await store.saveDevice({ ...record, peer: (await store.identity()).id })
    await agent.revoke("phone")
    expect(gw.sent.at(-1)?.subject).toMatch(/^relay\.cmd\.revoke\./)
    expect(gw.sent.at(-1)?.body.pairId).toBe("P1")
    expect(await agent.phones()).toEqual([])
    await agent.stop()
  })

  test("signed into an install, the machine names it as home; a home that forbids phones refuses offers and ends the pairs", async () => {
    const gw = fakeGateway()
    const store = fileStore(path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "m"))
    const agent = new MobileAgent({
      store,
      connect: async () => gw.conn,
      gatewayHost: "dev.buff.systems",
      display: () => "laptop",
      exec: async () => ({ ok: true }),
      now: () => 1_000,
    })
    const home = "H".repeat(43)
    await agent.setHome({ peer: home, name: "acme", kind: "install", forbidden: false })
    await agent.offer("code")
    expect(gw.sent.find((s) => s.subject.startsWith("relay.cmd.register."))!.body.home).toBe(home)
    expect(agent.status(0).home).toEqual({ name: "acme", kind: "install", forbidden: false })

    await store.saveDevice({ ...record, peer: (await store.identity()).id })
    await agent.setHome({ peer: home, name: "acme", kind: "install", forbidden: true })
    expect(await agent.phones()).toEqual([])
    expect(gw.sent.some((s) => s.subject.startsWith("relay.cmd.revoke.") && s.body.pairId === "P1")).toBe(true)
    await expect(agent.offer("qr")).rejects.toThrow(/«acme»/)
    expect(agent.offers()).toEqual([])

    await agent.setHome(null)
    expect(agent.status(0).home).toBeNull()
    await agent.stop()
  })

  test("the phone learns where the machine is signed in: asked on connect, told when it changes (#684)", async () => {
    const gw = fakeGateway()
    const store = fileStore(path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "m"))
    const agent = new MobileAgent({
      store,
      connect: async () => gw.conn,
      gatewayHost: "dev.buff.systems",
      display: () => "laptop",
      exec: async () => ({ ok: true }),
      now: () => 1_000,
    })
    await store.saveDevice({ ...record, peer: (await store.identity()).id })
    const told: Array<[string, unknown]> = []
    agent.push = (device, payload) => void told.push([device, payload])
    // Not checked yet since the start: nothing said — the phone keeps what it knew.
    expect(agent.homeAnswer()).toEqual({})
    const home = { peer: "H".repeat(43), name: "acme", kind: "install" as const, forbidden: false }
    await agent.setHome(home)
    expect(agent.homeAnswer()).toEqual({ home: { name: "acme", kind: "install" } })
    expect(told).toEqual([["phone", { kind: "event", stream: "machine.home", record: { home: { name: "acme", kind: "install" } } }]])
    await agent.setHome(home)
    expect(told.length).toBe(1) // the same home again: nothing new to tell
    await agent.setHome(null)
    expect(agent.homeAnswer()).toEqual({ home: null })
    expect(told.at(-1)).toEqual(["phone", { kind: "event", stream: "machine.home", record: { home: null } }])
    await agent.stop()
  })

  test("a notice goes sealed to each paired phone except the one already watching", async () => {
    const gw = fakeGateway()
    const store = fileStore(path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "m"))
    const agent = new MobileAgent({
      store,
      connect: async () => gw.conn,
      gatewayHost: "dev.buff.systems",
      display: () => "laptop",
      exec: async () => ({ ok: true }),
      now: () => 1_000,
    })
    const machine = await store.identity()
    const [pixel, iphone] = [generateIdentity().identity, generateIdentity().identity]
    for (const [phone, pairId] of [[pixel, "P1"], [iphone, "P2"]] as const)
      await store.saveDevice({ ...record, peer: machine.id, device: phone.id, dh: b64u(phone.dhPublic), pairId })
    await agent.start()
    const message = { title: "Агент ждёт разрешения", body: "Поиск · laptop", link: "buff://m/session/s", at: 1 }
    expect(await agent.notify(message, (device) => device === iphone.id)).toBe(1)
    const sent = gw.sent.filter((s) => s.subject.startsWith("relay.cmd.push_send."))
    expect(sent.map((s) => s.body.to)).toEqual([pixel.id])
    const push = sent[0]!.body.push as SealedPush
    expect(openPush(pixel, { id: machine.id, dhPublic: machine.dhPublic }, push)).toEqual(message)
    await agent.stop()
  })

  test("without the gateway an offer says so in words", async () => {
    const agent = new MobileAgent({
      store: fileStore(path.join(await mkdtemp(path.join(os.tmpdir(), "mobile-")), "m")),
      connect: async () => {
        throw new Error("ECONNREFUSED")
      },
      gatewayHost: "buff.systems",
      display: () => "laptop",
      exec: async () => ({ ok: true }),
      now: () => 1_000,
    })
    await expect(agent.offer("qr")).rejects.toThrow(/Нет связи со шлюзом buff.systems/)
    await agent.stop()
  })
})
