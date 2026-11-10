// Телефон для Buff Code (#639): ключ машины — только владельцу и один на все запуски; новая сессия
// с телефона — проект и модель только из списков машины; машина регистрируется на шлюзе без
// лицензии и отключённый телефон теряет пару на шлюзе.
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PromptInput } from "@opencode/schema/prompt-input"
import { mkdtemp, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  b64u,
  generateIdentity,
  openPush,
  RefusalError,
  type DeviceRecord,
  type RelayConn,
  type SealedPush,
} from "@buff/mobile-protocol"
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
    if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
    if (route === "/api/model")
      return { location: {}, data: [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }] }
    if (route === "/api/session" && method === "POST") return { data: { id: "s1" } }
    if (route === "/api/session")
      return {
        data: [
          { id: "a", projectID: "p1", title: "Из окна", time: { created: 1, updated: 3 } },
          {
            id: "b",
            projectID: "p1",
            title: "С телефона",
            time: { created: 1, updated: 2 },
            metadata: { origin: "phone" },
          },
          { id: "c", parentID: "a", projectID: "p1", time: { created: 1, updated: 2 } },
          { id: "d", projectID: "p1", time: { created: 1, updated: 2, archived: 5 } },
        ],
      }
    if (route === "/api/session/active") return { data: { b: {} } }
    if (route === "/api/session/b/message")
      return { data: [{ id: "m1", type: "assistant", content: [{ type: "text", text: "x".repeat(5000) }] }] }
    if (route === "/api/session/b/permission")
      return { data: [{ id: "perm", action: "bash", resources: ["rm -rf build"] }] }
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
    await expect(api.run(record, "session.new", { project: "p1", model: "other/x" })).rejects.toBeInstanceOf(
      RefusalError,
    )
    calls.length = 0
    expect(
      await api.run(record, "session.new", {
        project: "p1",
        model: "anthropic/sonnet",
        prompt: "Привет",
        mode: "edit",
        plan: true,
      }),
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

  // #759: the phone picks how long the model thinks — the model's variants, as the window does.
  describe("the model's thinking mode (#759)", () => {
    const sent: { method: string; path: string; body?: unknown }[] = []
    const thinking = mobileApi(async (method, route, options) => {
      sent.push({ method, path: route, body: options?.body })
      if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
      if (route === "/api/model")
        return {
          data: [
            {
              id: "ds",
              modelID: "deepseek-v4",
              providerID: "litellm",
              name: "DeepSeek",
              variants: [{ id: "low" }, { id: "high" }, { id: "max" }],
            },
            { id: "glm", modelID: "glm-5", providerID: "litellm", name: "GLM", variants: [{ id: "high" }] },
            { id: "plain", modelID: "plain", providerID: "litellm", name: "Plain", variants: [] },
          ],
        }
      if (route === "/api/model/default") return { data: undefined }
      if (route === "/api/session" && method === "POST") return { data: { id: "s1" } }
      if (route === "/api/session") return { data: [] }
      if (route === "/api/session/s1")
        return {
          data: {
            id: "s1",
            location: { directory: "/work/shop" },
            model: { id: "deepseek-v4", providerID: "litellm", variant: "high" },
          },
        }
      return { data: null }
    })

    test("models.list names each model's variants", async () => {
      const got = (await thinking.run(record, "models.list", { project: "p1" })).models as Record<string, unknown>[]
      expect(got.map((m) => m.variants)).toEqual([["low", "high", "max"], ["high"], undefined])
    })

    test("a new session takes the variant; default means none", async () => {
      sent.length = 0
      await thinking.run(record, "session.new", { project: "p1", model: "litellm/deepseek-v4", variant: "max" })
      const body = sent.find((c) => c.path === "/api/session" && c.method === "POST")?.body as { model?: unknown }
      expect(body.model).toEqual({ id: "deepseek-v4", providerID: "litellm", variant: "max" })
      sent.length = 0
      await thinking.run(record, "session.new", { project: "p1", model: "litellm/deepseek-v4", variant: "default" })
      const plain = sent.find((c) => c.path === "/api/session" && c.method === "POST")?.body as { model?: unknown }
      expect(plain.model).toEqual({ id: "deepseek-v4", providerID: "litellm" })
    })

    // Режимы ИИ (#835, эпик #783): окно контекста сессии — с телефона, как режим размышлений.
    test("session.context caps the session's window; 0 — the model's whole window", async () => {
      sent.length = 0
      await thinking.run(record, "session.context", { session: "s1", context: 200000 })
      expect(sent.at(-1)).toEqual({ method: "POST", path: "/api/session/s1/context-limit", body: { limit: { context: 200000 } } })
      sent.length = 0
      await thinking.run(record, "session.context", { session: "s1", context: 0 })
      expect(sent.at(-1)).toEqual({ method: "POST", path: "/api/session/s1/context-limit", body: { limit: null } })
    })

    test("a new session takes the context cap in its create body", async () => {
      sent.length = 0
      await thinking.run(record, "session.new", { project: "p1", model: "litellm/deepseek-v4", context: 64000 })
      const body = sent.find((c) => c.path === "/api/session" && c.method === "POST")?.body as { limit?: unknown }
      expect(body.limit).toEqual({ context: 64000 })
      sent.length = 0
      await thinking.run(record, "session.new", { project: "p1", model: "litellm/deepseek-v4" })
      const plain = sent.find((c) => c.path === "/api/session" && c.method === "POST")?.body as { limit?: unknown }
      expect(plain.limit).toBeUndefined()
    })

    test("a model switch keeps the variant the new model has, the window's one too", async () => {
      const switched = async (args: Record<string, unknown>) => {
        sent.length = 0
        await thinking.run(record, "session.model", { session: "s1", ...args })
        return (sent.find((c) => c.path === "/api/session/s1/model")?.body as { model?: unknown }).model
      }
      // No variant named: the session's «high» stays — GLM has it too.
      expect(await switched({ model: "litellm/glm-5" })).toEqual({
        id: "glm-5",
        providerID: "litellm",
        variant: "high",
      })
      // The new model has no such variant: none.
      expect(await switched({ model: "litellm/plain" })).toEqual({ id: "plain", providerID: "litellm" })
      // A variant named: that one; «default» — none.
      expect(await switched({ model: "litellm/deepseek-v4", variant: "low" })).toEqual({
        id: "deepseek-v4",
        providerID: "litellm",
        variant: "low",
      })
      expect(await switched({ model: "litellm/deepseek-v4", variant: "default" })).toEqual({
        id: "deepseek-v4",
        providerID: "litellm",
      })
    })
  })

  test("an empty first snapshot of a fresh directory is asked again until it settles (#739)", async () => {
    let asked = { model: 0, agent: 0 }
    const api = mobileApi(async (method, route) => {
      if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
      if (route === "/api/model")
        return {
          data: ++asked.model < 3 ? [] : [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }],
        }
      if (route === "/api/model/default") return { data: undefined }
      if (route === "/api/agent")
        return { data: ++asked.agent < 2 ? [] : [{ id: "build", name: "build", mode: "primary", hidden: false }] }
      if (route === "/api/session") return { data: [] }
      return { data: null }
    })
    const record = {
      peer: "m",
      device: "phone",
      dh: "d",
      display: "Pixel",
      pairId: "p",
      created: 1,
      login: "u",
      org: null,
    }
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
        if (route === "/api/model/default")
          return { data: { id: "n", modelID: "flash", providerID: "openrouter", name: "Flash" } }
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
              {
                id: "child",
                parentID: "x",
                projectID: "p1",
                model: { id: "gone", providerID: "x" },
                time: { created: 1, updated: 9 },
              },
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
      if (route === "/api/model")
        return { data: [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }] }
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
    const text = (got.messages as { content: { text: string }[] }[])[0]!.content[0]!.text
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
      route === "/api/session/g"
        ? { data: { location: { directory: "/w" } } }
        : route === "/api/rpc/buff.goal/get"
          ? { output: {} }
          : { data: [] },
    )
    expect(((await noGoal.run(record, "session.state", { session: "g" })) as Record<string, unknown>).goal).toBeNull()
  })

  // #753: a subagent's session names its parent — the phone opens it read-only — and its title.
  test("session.state carries the session's parent and title", async () => {
    const child = mobileApi(async (method, route) =>
      route === "/api/session/c"
        ? { data: { id: "c", parentID: "root", title: "Найти шрифты", location: { directory: "/w" } } }
        : route === "/api/rpc/buff.goal/get"
          ? { output: {} }
          : { data: [] },
    )
    const got = (await child.run(record, "session.state", { session: "c" })) as Record<string, unknown>
    expect(got.parent).toBe("root")
    expect(got.title).toBe("Найти шрифты")
    const root = mobileApi(async (method, route) =>
      route === "/api/session/g"
        ? { data: { id: "g", location: { directory: "/w" } } }
        : route === "/api/rpc/buff.goal/get"
          ? { output: {} }
          : { data: [] },
    )
    const top = (await root.run(record, "session.state", { session: "g" })) as Record<string, unknown>
    expect(top.parent).toBeNull()
    expect(top.title).toBe("")
  })

  // #760: the phone shows the session's permission mode, the one set in the window too.
  test("session.state carries the session's permission mode and the plan mark", async () => {
    const stateOf = async (info: Record<string, unknown>) =>
      (await mobileApi(async (method, route) =>
        route === "/api/session/s"
          ? { data: { id: "s", location: { directory: "/w" }, ...info } }
          : route === "/api/rpc/buff.goal/get"
            ? { output: {} }
            : { data: [] },
      ).run(record, "session.state", { session: "s" })) as Record<string, unknown>
    const shell = { action: "shell", resource: "*", effect: "ask" }
    const edit = { action: "edit", resource: "*", effect: "ask" }
    expect(await stateOf({ permissions: [edit, shell] })).toMatchObject({ mode: "ask", plan: false })
    expect(await stateOf({ permissions: [shell] })).toMatchObject({ mode: "edit", plan: false })
    expect(await stateOf({ permissions: [] })).toMatchObject({ mode: "full", plan: false })
    expect(await stateOf({ permissions: [shell], agent: "plan" })).toMatchObject({ mode: "ask", plan: true })
    expect(await stateOf({ permissions: [{ action: "webfetch", resource: "*", effect: "deny" }] })).toMatchObject({
      mode: "custom",
    })
  })

  // #761: the phone opens a compaction's summary for the model whole, not clipped like the timeline.
  test("session.compaction hands the summary whole", async () => {
    const long = "итог ".repeat(2_000)
    const seen: string[] = []
    const api = mobileApi(async (method, route) => {
      seen.push(`${method} ${route}`)
      if (route === "/api/session/s/message/c1")
        return {
          data: { type: "compaction", id: "c1", status: "completed", reason: "auto", summary: long, recent: "x" },
        }
      if (route === "/api/session/s/message/u1") return { data: { type: "user", id: "u1", text: "hi" } }
      return { data: [] }
    })
    const got = (await api.run(record, "session.compaction", { session: "s", message: "c1" })) as Record<
      string,
      unknown
    >
    expect(got).toMatchObject({ status: "completed", summary: long })
    expect(seen).toContain("GET /api/session/s/message/c1")
    await expect(api.run(record, "session.compaction", { session: "s", message: "u1" })).rejects.toThrow()
  })

  // #762: the phone sees the session's subagents and which of them work — background ones too,
  // and ones whose call is not loaded on the phone yet.
  test("session.state lists the session's subagents and which of them run", async () => {
    let query: Record<string, unknown> | undefined
    const api = mobileApi(async (method, route, options) => {
      if (route === "/api/session") {
        query = options?.query as Record<string, unknown>
        return {
          data: [
            {
              id: "k2",
              parentID: "s",
              projectID: "p1",
              title: "Ревью фактов",
              agent: "review",
              time: { created: 2, updated: 3 },
            },
            { id: "k1", parentID: "s", projectID: "p1", title: "Ревью вёрстки", time: { created: 1, updated: 2 } },
          ],
        }
      }
      if (route === "/api/session/active") return { data: { k2: {} } }
      if (route === "/api/session/s") return { data: { id: "s", location: { directory: "/w" } } }
      if (route === "/api/rpc/buff.goal/get") return { output: {} }
      return { data: [] }
    })
    const got = (await api.run(record, "session.state", { session: "s" })) as Record<string, unknown>
    expect(query?.parentID).toBe("s")
    expect(got.subagents).toEqual([
      { id: "k2", title: "Ревью фактов", agent: "review", running: true },
      { id: "k1", title: "Ревью вёрстки", running: false },
    ])
  })

  test("a file from the phone arrives in chunks and goes into the prompt whole", async () => {
    calls.length = 0
    await api.run(record, "attachment_upload", {
      id: "u1",
      seq: 1,
      of: 2,
      name: "a.png",
      mime: "image/png",
      data: "CD==",
    })
    await api.run(record, "attachment_upload", {
      id: "u1",
      seq: 0,
      of: 2,
      name: "a.png",
      mime: "image/png",
      data: "AB",
    })
    await api.run(record, "session.prompt", { session: "s1", text: "смотри", attachments: [{ upload_id: "u1" }] })
    expect(calls.at(-1)?.body).toEqual({
      text: "смотри",
      metadata: { source: "phone" },
      files: [{ uri: "data:image/png;base64,ABCD==", name: "a.png" }],
      delivery: "queue",
    })
    // #676: the body is what the prompt endpoint takes — the schema decides, not this fake.
    expect(() =>
      Schema.decodeUnknownSync(Schema.Array(PromptInput.FileAttachment))(
        (calls.at(-1)?.body as { files: unknown }).files,
      ),
    ).not.toThrow()
    await expect(
      api.run(record, "session.prompt", { session: "s1", attachments: [{ upload_id: "u1" }] }),
    ).rejects.toBeInstanceOf(RefusalError)
  })

  test("files only inside the session's project, read in parts; RPC only from the list", async () => {
    const big = new Uint8Array(200 * 1024).fill(65)
    const filesApi = mobileApi(
      async (method, route) =>
        route.startsWith("/api/session/") ? { data: { location: { directory: "/work/shop" } } } : call(method, route),
      undefined,
      { fetch: async () => ({ mime: "text/plain", bytes: big }) },
    )
    await expect(filesApi.run(record, "files.read", { session: "s1", path: "../etc/passwd" })).rejects.toBeInstanceOf(
      RefusalError,
    )
    const first = (await filesApi.run(record, "files.read", { session: "s1", path: "a.txt" })) as Record<
      string,
      unknown
    >
    expect(first.size).toBe(200 * 1024)
    expect(first.next).toBe(96 * 1024)
    expect((first.text as string).length).toBe(96 * 1024)
    await expect(
      filesApi.run(record, "rpc", { session: "s1", id: "buff.memory", method: "list" }),
    ).rejects.toBeInstanceOf(RefusalError)
    await expect(
      filesApi.run(record, "rpc", { session: "s1", id: "buff.git", method: "reset" }),
    ).rejects.toBeInstanceOf(RefusalError)
  })

  // #708: документ (docx — zip, его тип содержит «xml») — байтами, не текстом; raw — всегда байтами,
  // чтобы телефон собрал большой файл из частей целиком.
  test("a document travels as bytes, and raw always does", async () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    const files = (mime: string, bytes: Uint8Array) =>
      mobileApi(
        async (_m, route) =>
          route.startsWith("/api/session/") ? { data: { location: { directory: "/w" } } } : { data: {} },
        undefined,
        {
          fetch: async () => ({ mime, bytes }),
        },
      )
    const zipLike = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x41, 0x42])
    const doc = (await files(docx, zipLike).run(record, "files.read", { session: "s1", path: "a.docx" })) as Record<
      string,
      unknown
    >
    expect(doc.base64).toBe(Buffer.from(zipLike).toString("base64"))
    expect(doc.text).toBeUndefined()
    const text = new TextEncoder().encode("привет")
    const md = files("text/markdown", text)
    expect(
      ((await md.run(record, "files.read", { session: "s1", path: "a.md" })) as Record<string, unknown>).text,
    ).toBe("привет")
    const raw = (await md.run(record, "files.read", { session: "s1", path: "a.md", raw: true })) as Record<
      string,
      unknown
    >
    expect(raw.base64).toBe(Buffer.from(text).toString("base64"))
    expect(BuffMobileText.isText("application/json", new Uint8Array([0]))).toBe(true)
    expect(BuffMobileText.isText("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(false)
    expect(BuffMobileText.isText("application/octet-stream", new TextEncoder().encode("plain"))).toBe(true)
  })

  // #765: Setup mode from the phone — the RPC, the session's agent and setup mark, global forms and their owner.
  test("setup mode: buff.setup is allowed, a setup session is marked, a global form keeps its owner and is answered to it", async () => {
    const seen: Array<{ method: string; path: string; body?: unknown }> = []
    const setupApi = mobileApi(async (method, route, options) => {
      seen.push({ method, path: route, body: options?.body })
      if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
      if (route === "/api/session")
        return {
          data: [{ id: "s", projectID: "p1", title: "Почта", agent: "setup", time: { created: 1, updated: 3 } }],
        }
      if (route === "/api/session/s")
        return { data: { id: "s", agent: "setup", title: "Почта", location: { directory: "/work/shop" } } }
      if (route === "/api/session/s/form") return { data: [{ id: "f1", sessionID: "s", title: "Ключ", fields: [] }] }
      if (route === "/api/form")
        return {
          data: [
            { id: "g1", sessionID: "global", title: "knowledge", fields: [] },
            { id: "f9", sessionID: "other", title: "чужая", fields: [] },
          ],
        }
      if (route === "/api/rpc/buff.setup/open") return { output: { session: "s2" } }
      return { data: {} }
    })
    const listed = (await setupApi.run(record, "sessions.list", { project: "p1" })) as unknown as {
      sessions: { agent?: string }[]
    }
    expect(listed.sessions[0]?.agent).toBe("setup")
    const state = (await setupApi.run(record, "session.state", { session: "s" })) as unknown as {
      setup?: boolean
      forms: { id: string }[]
    }
    expect(state.setup).toBe(true)
    expect(state.forms.map((f) => f.id)).toEqual(["f1", "g1"])
    await setupApi.run(record, "question.answer", { session: "s", form: "g1", owner: "global", answer: { add: true } })
    await setupApi.run(record, "question.cancel", { session: "s", form: "f1" })
    expect(seen.filter((c) => c.path.includes("/form/")).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/session/global/form/g1/reply",
      "DELETE /api/session/s/form/f1",
    ])
    const opened = (await setupApi.run(record, "rpc", {
      project: "p1",
      id: "buff.setup",
      method: "open",
      input: {},
    })) as {
      output?: unknown
    }
    expect(opened.output).toEqual({ session: "s2" })
    await expect(
      setupApi.run(record, "rpc", { project: "p1", id: "buff.setup", method: "nope" }),
    ).rejects.toBeInstanceOf(RefusalError)
  })

  test("what the phone may not do is refused", async () => {
    await expect(api.run(record, "files.write", {})).rejects.toBeInstanceOf(RefusalError)
    await expect(
      api.run(record, "permission.answer", { session: "s", request: "r", decision: "maybe" }),
    ).rejects.toBeInstanceOf(RefusalError)
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
    expect(told).toEqual([
      ["phone", { kind: "event", stream: "machine.home", record: { home: { name: "acme", kind: "install" } } }],
    ])
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
    for (const [phone, pairId] of [
      [pixel, "P1"],
      [iphone, "P2"],
    ] as const)
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

// Модели для телефона — как в композере окна (#743): отметки окна, иначе новейшие в семействе и без даты.
describe("models as the window shows them (#743)", () => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const list = [
    {
      id: "sonnet-5",
      modelID: "sonnet-5",
      providerID: "anthropic",
      name: "Sonnet 5",
      family: "sonnet",
      time: { released: now - 10 * day },
    },
    {
      id: "sonnet-4",
      modelID: "sonnet-4",
      providerID: "anthropic",
      name: "Sonnet 4",
      family: "sonnet",
      time: { released: now - 200 * day },
    },
    { id: "mystery", modelID: "mystery", providerID: "openrouter", name: "Mystery" },
  ]
  const api = (prefs: { providerID: string; modelID: string; visibility: "show" | "hide" }[]) =>
    mobileApi(
      async (method, route) => {
        if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
        if (route === "/api/model") return { data: list }
        if (route === "/api/model/default") return { data: list[1] }
        if (route === "/api/session") return { data: [] }
        return { data: null }
      },
      undefined,
      { modelPrefs: async () => prefs },
    )

  type Listed = { models: { id: string }[]; default?: string }
  test("without choices the phone sees the newest of a family and the undated; the default is among them", async () => {
    const got = (await api([]).run(record, "models.list", { project: "p1" })) as unknown as Listed
    expect(got.models.map((m) => m.id)).toEqual(["anthropic/sonnet-5", "openrouter/mystery"])
    expect(got.default).toBe("anthropic/sonnet-5")
  })

  // #757: after a refusal with files the phone looks for a model that reads them among all of them.
  test("all: true lists every model, hidden ones too", async () => {
    const got = (await api([]).run(record, "models.list", { project: "p1", all: true })) as unknown as Listed
    expect(got.models.map((m) => m.id)).toEqual(["anthropic/sonnet-5", "anthropic/sonnet-4", "openrouter/mystery"])
  })

  test("choices name the catalogue id: the «fast» variant shares its API id yet is told apart", async () => {
    const twin = [
      ...list,
      {
        id: "sonnet-5-fast",
        modelID: "sonnet-5",
        providerID: "anthropic",
        name: "Sonnet 5 Fast",
        family: "sonnet",
        time: { released: now - 10 * day },
      },
    ]
    const twinApi = (prefs: { providerID: string; modelID: string; visibility: "show" | "hide" }[]) =>
      mobileApi(
        async (method, route) => {
          if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
          if (route === "/api/model") return { data: twin }
          if (route === "/api/model/default") return { data: undefined }
          if (route === "/api/session") return { data: [] }
          return { data: null }
        },
        undefined,
        { modelPrefs: async () => prefs },
      )
    // By default one of a family's twins (the first) shows; a choice on the catalogue id hides exactly it.
    const plain = (await twinApi([]).run(record, "models.list", { project: "p1" })) as unknown as Listed
    expect(plain.models.map((m) => m.id)).toEqual(["anthropic/sonnet-5", "openrouter/mystery"])
    const chosen = (await twinApi([
      { providerID: "anthropic", modelID: "sonnet-5", visibility: "hide" },
      { providerID: "anthropic", modelID: "sonnet-5-fast", visibility: "show" },
    ]).run(record, "models.list", { project: "p1" })) as unknown as Listed
    expect(chosen.models.map((m: { id: string; name?: string }) => `${m.id}:${(m as { name: string }).name}`)).toEqual([
      "openrouter/mystery:Mystery",
      "anthropic/sonnet-5:Sonnet 5 Fast",
    ])
  })

  test("the window's choices win: a shown old model appears, a hidden new one goes", async () => {
    const got = (await api([
      { providerID: "anthropic", modelID: "sonnet-4", visibility: "show" },
      { providerID: "anthropic", modelID: "sonnet-5", visibility: "hide" },
    ]).run(record, "models.list", { project: "p1" })) as unknown as Listed
    expect(got.models.map((m) => m.id)).toEqual(["anthropic/sonnet-4", "openrouter/mystery"])
    expect(got.default).toBe("anthropic/sonnet-4")
    await expect(
      api([]).run(record, "session.new", { project: "p1", model: "anthropic/sonnet-4" }),
    ).rejects.toBeInstanceOf(RefusalError)
  })
})

// #757: ход упал на файлах — телефон предлагает разобрать их кодом, сменить модель или продолжить без них.
describe("a turn that failed on files (#757)", () => {
  const sent: { method: string; path: string; body?: unknown }[] = []
  const api = mobileApi(async (method, route, init) => {
    sent.push({ method, path: route, body: (init as { body?: unknown } | undefined)?.body })
    if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
    if (route === "/api/session") return { data: [] }
    if (route === "/api/model")
      return {
        data: [
          {
            id: "m",
            modelID: "glm",
            providerID: "litellm",
            name: "GLM",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
          },
          {
            id: "n",
            modelID: "kimi",
            providerID: "litellm",
            name: "Kimi",
            capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
          },
        ],
      }
    if (route === "/api/session/s1/message")
      return {
        data: [
          { id: "a2", type: "assistant", error: { type: "provider.invalid-request", message: "no images" } },
          {
            id: "u2",
            type: "user",
            text: "что на картинке?",
            files: [{ data: "aGVsbG8=", mime: "image/png", name: "logo.png", source: { type: "inline" } }],
            metadata: { source: "phone", model: { id: "glm", providerID: "litellm" } },
          },
          { id: "u1", type: "user", text: "раньше" },
        ],
      }
    return { data: {} }
  })

  test("each model says which kinds of files it reads", async () => {
    expect((await api.run(record, "models.list", { project: "p1" })).models).toEqual([
      { id: "litellm/glm", name: "GLM", provider: "litellm", input: ["text"] },
      { id: "litellm/kimi", name: "Kimi", provider: "litellm", input: ["text", "image", "pdf"] },
    ])
  })

  test("a message can stop sending a format of files to the model", async () => {
    sent.length = 0
    await api.run(record, "session.prompt", {
      session: "s1",
      text: "без файлов",
      omitMedia: ["image", "nonsense", 7],
      omitAs: "ignore",
    })
    expect(sent.at(-1)).toEqual({
      method: "POST",
      path: "/api/session/s1/prompt",
      body: {
        text: "без файлов",
        metadata: { source: "phone", omitMedia: ["image"], omitAs: "ignore" },
        delivery: "queue",
      },
    })
  })

  test("the failed message goes again as it was, on the model chosen now", async () => {
    sent.length = 0
    await api.run(record, "session.retry", { session: "s1", message: "u2" })
    expect(sent.at(-1)).toEqual({
      method: "POST",
      path: "/api/session/s1/prompt",
      body: {
        text: "что на картинке?",
        files: [{ uri: "data:image/png;base64,aGVsbG8=", name: "logo.png" }],
        metadata: { source: "phone" },
      },
    })
    await expect(api.run(record, "session.retry", { session: "s1", message: "gone" })).rejects.toBeInstanceOf(
      RefusalError,
    )
  })
})

// #811: the phone sends while the agent works — the message waits for the end of the turn (queue),
// «send now» steers it; the phone sees what waits and can drop it.
describe("message queue from the phone (#811)", () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const api = mobileApi(async (method, route, options) => {
    calls.push({ method, path: route, body: options?.body })
    if (route === "/api/session/active") return { data: { s1: {} } }
    if (route === "/api/session/s1/inbox")
      return {
        data: [
          { id: "q1", type: "user", delivery: "queue", payload: { text: "и ещё тесты", files: [{ uri: "x" }] } },
          { id: "q2", type: "user", delivery: "steer", payload: { text: "уже уходит" } },
          { id: "q3", type: "synthetic", delivery: "queue", payload: { text: "служебное" } },
        ],
      }
    return { data: [] }
  })

  test("a prompt waits for the end of the turn unless the phone asks to send it now", async () => {
    await api.run(record, "session.prompt", { session: "s1", text: "потом" })
    expect((calls.at(-1)?.body as { delivery: string }).delivery).toBe("queue")
    await api.run(record, "session.prompt", { session: "s1", text: "сейчас", delivery: "steer" })
    expect((calls.at(-1)?.body as { delivery: string }).delivery).toBe("steer")
    await expect(api.run(record, "session.prompt", { session: "s1", text: "x", delivery: "later" })).rejects.toBeInstanceOf(
      RefusalError,
    )
  })

  test("the session state lists the user's queued messages only", async () => {
    const got = (await api.run(record, "session.watch", { session: "s1" })) as Record<string, unknown>
    expect(got.queued).toEqual([{ id: "q1", text: "и ещё тесты", files: 1 }])
  })

  test("a queued message can be dropped or sent at once", async () => {
    await api.run(record, "session.queue.cancel", { session: "s1", id: "q1" })
    expect(calls.at(-1)).toEqual({ method: "DELETE", path: "/api/session/s1/inbox/q1", body: undefined })
    await api.run(record, "session.queue.send", { session: "s1", id: "q1" })
    expect(calls.at(-1)).toEqual({ method: "PATCH", path: "/api/session/s1/inbox/q1", body: { delivery: "steer" } })
  })
})
