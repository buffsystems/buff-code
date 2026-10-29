// Настройка при запуске (#401) и ожидание моделей Buff (#399) в разовых командах.
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { buffModelsHint } from "../src/commands/handlers/buff/models-hint"

type Choice = { org: string; project: string | null; spaces: string[] }

/** A service whose model list fills in only after the buff.context rpc was answered —
 *  as the real one does: rpc waits for the plugins, the model list does not. */
function service(opts: { choice: Choice | null; models: string[]; optionsError?: { type: string; message: string } }) {
  const calls: string[] = []
  let pluginsUp = false
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
      const call = url.pathname.match(/^\/api\/rpc\/buff\.context\/(\w+)$/)
      if (call) {
        calls.push(`rpc.${call[1]}`)
        pluginsUp = true
        if (call[1] === "get") return Response.json({ output: opts.choice })
        if (call[1] === "options" && opts.optionsError)
          return Response.json({ _tag: "RpcError", ...opts.optionsError }, { status: 400 })
        if (call[1] === "options") return Response.json({ output: { orgs: ["acme"], projects: [], spaces: [] } })
      }
      if (url.pathname === "/api/model") {
        calls.push("model.list")
        const data = (pluginsUp ? opts.models : []).map((id) => {
          const [providerID, ...rest] = id.split("/")
          return { providerID, id: rest.join("/") }
        })
        return Response.json({ location: { directory: process.cwd() }, data })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return { server, calls, [Symbol.dispose]: () => server.stop(true) }
}

async function cli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    env: { ...process.env, ...env },
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode, all: stdout + stderr }
}

const acme = { org: "acme", project: null, spaces: [] }

describe("no separate setup commands (#401)", () => {
  test("org, project and space are gone from the console; auth login is back (#562)", async () => {
    const help = await cli(["--help"])
    expect(help.exitCode).toBe(0)
    for (const gone of ["Buff: выбрать организацию", "Buff: выбрать проект", "Buff: выбрать пространства"])
      expect(help.stdout).not.toContain(gone)
    const auth = await cli(["auth", "--help"], { LANGUAGE: "en" })
    expect(auth.stdout).toContain("log in to a provider")
  })
})

describe("buff models (#399, #401)", () => {
  test("waits for the plugins, then lists Buff's models — stdout stays a clean list", async () => {
    using s = service({ choice: acme, models: ["buff/z-ai/glm-5.3-flash"] })
    const r = await cli(["models", "--server", s.server.url.origin])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("buff/z-ai/glm-5.3-flash\n")
    expect(s.calls.indexOf("rpc.get")).toBeLessThan(s.calls.indexOf("model.list"))
  })

  test("not set up and no terminal to ask in: a short error that points to buff itself", async () => {
    using s = service({ choice: null, models: [] })
    const r = await cli(["models", "--server", s.server.url.origin], { LANGUAGE: "ru" })
    expect(r.exitCode).not.toBe(0)
    expect(r.all).toContain("запустите buff")
    expect(r.all).not.toContain("buff org")
  })

  test("signed out, no own provider and no terminal: a short error naming both ways in", async () => {
    using s = service({
      choice: acme,
      models: [],
      optionsError: { type: "signed_out", message: "Вход в Buff не выполнен." },
    })
    const r = await cli(["models", "--server", s.server.url.origin], { LANGUAGE: "ru" })
    expect(r.exitCode).not.toBe(0)
    expect(r.all).toContain("запустите buff")
    expect(r.all).toContain("buff auth login")
  })

  test("signed out with an own provider connected: no sign-in asked, its models listed (#562)", async () => {
    using s = service({
      choice: acme,
      models: ["openrouter/qwen/qwen3-coder"],
      optionsError: { type: "signed_out", message: "Вход в Buff не выполнен." },
    })
    const r = await cli(["models", "--server", s.server.url.origin])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("openrouter/qwen/qwen3-coder\n")
  })

  test("a connector that does not answer is said in its own words", async () => {
    using s = service({
      choice: acme,
      models: [],
      optionsError: { type: "unreachable", message: "Коннектор компании не ответил: таймаут" },
    })
    const r = await cli(["models", "--server", s.server.url.origin])
    expect(r.exitCode).not.toBe(0)
    expect(r.all).toContain("Коннектор компании не ответил")
  })
})

describe("the hint when Buff has no models", () => {
  test("nothing to say when Buff's models are there", () => {
    expect(buffModelsHint({ hasBuffModels: true, org: "acme" })).toBeUndefined()
  })
  test("a chosen organisation with no models says so by name", () => {
    expect(buffModelsHint({ hasBuffModels: false, org: "acme" })).toContain("acme")
  })
})
