// Окно контекста (#837, эпик #783): потолок контекста в консоли — у сессии живёт на сервере,
// у будущей сессии — черновиком до создания; дефолт — ключ `context` конфига.
import { expect, test } from "bun:test"
import { model, renderLocal, session } from "../fixture/local"
import { json } from "../fixture/tui-client"

const config = () => json([{ type: "document", info: { context: 64_000 } }])

test("before a session exists the config's cap is the draft, and a choice replaces it locally", async () => {
  const posts: { path: string; body: unknown }[] = []
  await using setup = await renderLocal({
    models: [model("first")],
    fetch: async (url, request) => {
      if (url.pathname === "/api/config") return config()
      if (request.method === "POST" && url.pathname.endsWith("/context-limit")) {
        posts.push({ path: url.pathname, body: await request.json() })
        return new Response(null, { status: 204 })
      }
    },
  })
  expect(setup.local.contextLimit.current()).toBe(64_000)
  expect(setup.local.contextLimit.modelWindow()).toBe(10_000)
  setup.local.contextLimit.set(8_000)
  expect(setup.local.contextLimit.current()).toBe(8_000)
  expect(setup.local.contextLimit.draft()).toEqual({ context: 8_000 })
  setup.local.contextLimit.set(0)
  expect(setup.local.contextLimit.current()).toBe(0)
  expect(setup.local.contextLimit.draft()).toBeUndefined()
  expect(posts).toEqual([])
})

test("in a session the cap is the session's, and a choice goes to the server", async () => {
  const posts: { path: string; body: unknown }[] = []
  await using setup = await renderLocal({
    models: [model("first")],
    sessions: [{ ...session("ses_cap", { providerID: "provider", id: "first" }), limit: { context: 5_000 } }],
    fetch: async (url, request) => {
      if (url.pathname === "/api/config") return config()
      if (request.method === "POST" && url.pathname.endsWith("/context-limit")) {
        posts.push({ path: url.pathname, body: await request.json() })
        return new Response(null, { status: 204 })
      }
    },
  })
  await setup.data.session.sync("ses_cap")
  setup.route.navigate({ type: "session", sessionID: "ses_cap" })
  expect(setup.local.contextLimit.current()).toBe(5_000)
  setup.local.contextLimit.set(8_000)
  await setup.waitFor(() => posts.length === 1)
  expect(posts[0]).toEqual({ path: "/api/session/ses_cap/context-limit", body: { limit: { context: 8_000 } } })
  setup.local.contextLimit.set(0)
  await setup.waitFor(() => posts.length === 2)
  expect(posts[1]?.body).toEqual({ limit: null })
  // The session keeps its own value until the server's event says otherwise.
  expect(setup.local.contextLimit.current()).toBe(5_000)
})
