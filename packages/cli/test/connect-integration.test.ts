// Вход в интеграцию без отдельной команды (#401): его зовёт настройка при запуске. Это те же
// проверки, что были у `auth login`, — логика та же, изменилось только, откуда её зовут.
import { describe, expect, test } from "bun:test"
import { Cause, Effect } from "effect"
import { OpenCode, type FormFields } from "@opencode/client"
import { OPENCODE_VERSION } from "../src/version"
import { asksPerson, connectIntegration } from "../src/commands/handlers/auth/login"

function located<T>(data: T) {
  return {
    location: { directory: process.cwd(), project: { id: "project", directory: process.cwd(), canonical: process.cwd() } },
    data,
  }
}

function authServer(fetch: (request: Request, url: URL) => Response | Promise<Response>) {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
      if (url.pathname === "/api/model/default") return Response.json(located(null))
      return fetch(request, url)
    },
  })
  return { server, [Symbol.dispose]: () => server.stop(true) }
}

const connect = (origin: string, target: string) =>
  Effect.runPromiseExit(connectIntegration(OpenCode.make({ baseUrl: origin }), target).pipe(Effect.scoped))

describe("connectIntegration (#401)", () => {
  test("runs command authentication without interactive input", async () => {
    const requests: string[] = []
    using s = authServer((request, url) => {
      requests.push(`${request.method} ${url.pathname}`)
      if (url.pathname === "/api/integration")
        return Response.json(
          located([
            {
              id: "company",
              name: "Company",
              methods: [{ id: "login", type: "command", label: "Company login", command: ["company", "login"] }],
              connections: [],
            },
          ]),
        )
      if (url.pathname === "/api/integration/company/connect/command" && request.method === "POST")
        return Response.json(located({ attemptID: "con_test", time: { created: 1, expires: 2 } }))
      if (url.pathname === "/api/integration/company/connect/command/con_test" && request.method === "GET")
        return Response.json(located({ status: "complete", time: { created: 1, expires: 2 } }))
      if (url.pathname === "/api/integration/company/connect/command/con_test" && request.method === "DELETE")
        return new Response(null, { status: 204 })
      return new Response("Not found", { status: 404 })
    })
    const exit = await connect(s.server.url.origin, "company")
    expect(exit._tag).toBe("Success")
    expect(requests).toContainEqual("POST /api/integration/company/connect/command")
    expect(requests).toContainEqual("DELETE /api/integration/company/connect/command/con_test")
  })

  test.each([
    { id: "openai", method: "browser", form: undefined, answer: undefined },
    {
      // A preset address (BUFF_CONNECTOR_URL) is a hidden field with a default: nothing is asked.
      id: "buff",
      method: "device",
      form: [
        { type: "string", key: "connector", hidden: true, format: "uri", default: "https://connector.company.local:8767" },
      ] satisfies FormFields,
      answer: { connector: "https://connector.company.local:8767" },
    },
  ])("completes $id/$method OAuth", async (input) => {
    const bodies: unknown[] = []
    const endpoint = `/api/integration/${input.id}/connect/oauth`
    using s = authServer(async (request, url) => {
      if (url.pathname === "/api/integration")
        return Response.json(
          located([
            {
              id: input.id,
              name: input.id,
              methods: [{ id: input.method, type: "oauth", label: "Browser", form: input.form }],
              connections: [],
            },
          ]),
        )
      if (url.pathname === endpoint && request.method === "POST") {
        bodies.push(await request.json())
        return Response.json(
          located({
            attemptID: "con_oauth",
            url: "https://example.com/authorize",
            instructions: "Authorize",
            mode: "auto",
            time: { created: 1, expires: 2 },
          }),
        )
      }
      if (url.pathname === `${endpoint}/con_oauth` && request.method === "GET")
        return Response.json(located({ status: "complete", time: { created: 1, expires: 2 } }))
      if (url.pathname === `${endpoint}/con_oauth` && request.method === "DELETE") return new Response(null, { status: 204 })
      return new Response("Not found", { status: 404 })
    })
    const exit = await connect(s.server.url.origin, input.id)
    expect(exit._tag).toBe("Success")
    expect(bodies).toEqual([{ methodID: input.method, ...(input.answer ? { answer: input.answer } : {}) }])
  })

  // #458: начало входа отклонено — причина словами службы, а не «Вход не удался».
  test("a refused start fails with the service's reason when there is nobody to ask again", async () => {
    using s = authServer((request, url) => {
      if (url.pathname === "/api/integration")
        return Response.json(
          located([
            {
              id: "buff",
              name: "Buff",
              methods: [
                {
                  id: "device",
                  type: "oauth",
                  label: "Вход через коннектор компании",
                  form: [{ type: "string", key: "connector", hidden: true, default: "http://127.0.0.1:1" }],
                },
              ],
              connections: [],
            },
          ]),
        )
      if (url.pathname === "/api/integration/buff/connect/oauth" && request.method === "POST")
        return Response.json(
          { _tag: "InvalidRequestError", kind: "integration_authorization", message: "Коннектор не отвечает." },
          { status: 400 },
        )
      return new Response("Not found", { status: 404 })
    })
    const exit = await connect(s.server.url.origin, "buff")
    expect(exit._tag).toBe("Failure")
    expect(exit._tag === "Failure" && String(Cause.squash(exit.cause))).toContain("Коннектор не отвечает.")
  })

  test("asking again makes sense only when the person typed the answer", () => {
    expect(asksPerson([{ type: "string", key: "connector", required: true }])).toBe(true)
    // Предустановленный адрес (BUFF_CONNECTOR_URL) спрашивать бессмысленно: ответ будет тем же.
    expect(asksPerson([{ type: "string", key: "connector", hidden: true, default: "https://c.local" }])).toBe(false)
    expect(asksPerson(undefined)).toBe(false)
  })

  test("fails the sign-in when status polling fails", async () => {
    using s = authServer((request, url) => {
      if (url.pathname === "/api/integration")
        return Response.json(
          located([{ id: "openai", name: "OpenAI", methods: [{ id: "browser", type: "oauth", label: "Browser" }], connections: [] }]),
        )
      if (url.pathname === "/api/integration/openai/connect/oauth" && request.method === "POST")
        return Response.json(
          located({
            attemptID: "con_oauth",
            url: "https://example.com/authorize",
            instructions: "Authorize",
            mode: "auto",
            time: { created: 1, expires: 2 },
          }),
        )
      if (url.pathname === "/api/integration/openai/connect/oauth/con_oauth" && request.method === "GET")
        return new Response("Unavailable", { status: 500 })
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      return new Response("Not found", { status: 404 })
    })
    const exit = await connect(s.server.url.origin, "openai")
    expect(exit._tag).toBe("Failure")
  })
})
