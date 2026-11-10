// Скриптовое подключение (#765): файлы, конфигурация, раннер по stdio на bun — без зависимостей.
import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BuffConnectionScript } from "../../src/buff/connection-script"

describe("files and configuration", () => {
  test("the script and the runner live in the user's connections folder; the command is buff + runner + script", () => {
    const files = BuffConnectionScript.paths("/home/u/.config/buff", "mail")
    expect(files).toEqual({
      directory: "/home/u/.config/buff/connections",
      runner: "/home/u/.config/buff/connections/_runner.mjs",
      script: "/home/u/.config/buff/connections/mail.ts",
    })
    const config = BuffConnectionScript.config(files, { TOKEN: "{secret:sec_1}" })
    expect(config).toEqual({
      type: "local",
      command: ["buff", files.runner, files.script],
      environment: { TOKEN: "{secret:sec_1}" },
    })
    expect(BuffConnectionScript.isScript(config)).toBe(true)
    expect(BuffConnectionScript.isScript({ type: "local", command: ["npx", "x"] })).toBe(false)
    expect("environment" in BuffConnectionScript.config(files, {})).toBe(false)
  })
  test("the runner on disk is rewritten when missing or from another Buff Code", () => {
    expect(BuffConnectionScript.stale(undefined)).toBe(true)
    expect(BuffConnectionScript.stale("// buff-runner 000000000000\nold")).toBe(true)
    expect(BuffConnectionScript.stale(BuffConnectionScript.stamped)).toBe(false)
  })
  test("an empty module or one without exports is refused in words", () => {
    expect(BuffConnectionScript.problem("  ")).toBe("The script is empty.")
    expect(BuffConnectionScript.problem("const tools = []")).toContain("must export `tools`")
    expect(BuffConnectionScript.problem("export const tools = []")).toBeUndefined()
  })
})

describe("the runner speaks MCP over stdio", () => {
  test("initialize, tools/list, tools/call — ok, error and unknown tool", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "buff-script-"))
    const runner = path.join(dir, "_runner.mjs")
    const script = path.join(dir, "probe.ts")
    await writeFile(runner, BuffConnectionScript.stamped)
    await writeFile(
      script,
      `export const instructions = "Probe connection"
export const tools = [
  { name: "echo", description: "Echo", input: { type: "object", properties: { text: { type: "string" } } },
    run: async (args: { text: string }) => ({ echoed: args.text, token: process.env.PROBE_TOKEN }) },
  { name: "boom", description: "Fails", input: { type: "object" }, run: async () => { throw new Error("no way") } },
]`,
    )
    const child = Bun.spawn([process.execPath, runner, script], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PROBE_TOKEN: "t0k", BUN_BE_BUN: "1" },
    })
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom", arguments: {} } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } },
      { jsonrpc: "2.0", id: 6, method: "ping" },
    ]
    child.stdin.write(requests.map((request) => JSON.stringify(request)).join("\n") + "\n")
    await child.stdin.end()
    const out = await new Response(child.stdout).text()
    await child.exited
    const replies = new Map(
      out
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { id: number; result?: unknown; error?: { message: string } })
        .map((reply) => [reply.id, reply] as const),
    )
    expect(replies.get(1)?.result).toMatchObject({ instructions: "Probe connection", capabilities: { tools: {} } })
    expect(replies.get(2)?.result).toEqual({
      tools: [
        {
          name: "echo",
          description: "Echo",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        },
        { name: "boom", description: "Fails", inputSchema: { type: "object" } },
      ],
    })
    expect(replies.get(3)?.result).toMatchObject({
      isError: false,
      structuredContent: { echoed: "hi", token: "t0k" },
    })
    expect(replies.get(4)?.result).toMatchObject({ isError: true, content: [{ type: "text", text: "no way" }] })
    expect(replies.get(5)?.error?.message).toBe("Unknown tool: nope")
    expect(replies.get(6)?.result).toEqual({})
  })
})
