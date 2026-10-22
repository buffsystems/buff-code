// MCP-серверы в файле конфигурации (#444): чтение и правка текста, остальное в файле не трогается.
import { describe, expect, test } from "bun:test"
import { BuffMcpFile } from "@opencode/core/buff/mcp-file"

const local = { type: "local" as const, command: ["npx", "-y", "srv"] }

describe("reading", () => {
  test("servers are read as written — substitutions are not expanded", () => {
    const text = `{
      // мои серверы
      "mcp": { "servers": { "gh": { "type": "remote", "url": "https://x", "headers": { "Authorization": "Bearer {env:GH}" } } } },
    }`
    expect(BuffMcpFile.servers(text)).toEqual({
      gh: { type: "remote", url: "https://x", headers: { Authorization: "Bearer {env:GH}" } },
    })
  })

  test("the old layout — a server right under mcp — is read too", () => {
    expect(
      BuffMcpFile.servers('{ "mcp": { "old": { "type": "local", "command": ["srv"] }, "timeout": { "startup": 5 } } }'),
    ).toEqual({
      old: { type: "local", command: ["srv"] },
    })
  })

  test("a file without servers, or no file at all, has none", () => {
    expect(BuffMcpFile.servers('{ "shell": "zsh" }')).toEqual({})
    expect(BuffMcpFile.servers("")).toEqual({})
  })

  test("a broken file is refused, not guessed at", () => {
    expect(() => BuffMcpFile.servers("{ nope")).toThrow("не читается")
  })
})

describe("writing", () => {
  test("a server is added without touching the rest — comments stay", () => {
    const text = '{\n  // оболочка\n  "shell": "zsh"\n}\n'
    const next = BuffMcpFile.withServer(text, "files", local)
    expect(next).toContain("// оболочка")
    expect(next).toContain('"shell": "zsh"')
    expect(BuffMcpFile.servers(next)).toEqual({ files: local })
  })

  test("an empty or missing file becomes a valid one", () => {
    const next = BuffMcpFile.withServer("", "files", local)
    expect(JSON.parse(next)).toEqual({ mcp: { servers: { files: local } } })
    expect(next.endsWith("\n")).toBe(true)
  })

  test("a server is replaced whole", () => {
    const first = BuffMcpFile.withServer("", "files", { ...local, environment: { A: "1" } })
    expect(BuffMcpFile.servers(BuffMcpFile.withServer(first, "files", local))).toEqual({ files: local })
  })

  test("a server is removed, the others stay", () => {
    const both = BuffMcpFile.withServer(BuffMcpFile.withServer("", "a", local), "b", local)
    expect(BuffMcpFile.servers(BuffMcpFile.withServer(both, "a", undefined))).toEqual({ b: local })
  })

  test("saving a server kept in the old layout moves it to the current one", () => {
    const text = '{ "mcp": { "old": { "type": "local", "command": ["srv"] } } }'
    const next = BuffMcpFile.withServer(text, "old", local)
    expect(JSON.parse(next)).toEqual({ mcp: { servers: { old: local } } })
    expect(JSON.parse(BuffMcpFile.withServer(text, "old", undefined))).toEqual({ mcp: {} })
  })

  test("switching a server off and on writes only that", () => {
    const text = BuffMcpFile.withServer("", "files", local)
    const off = BuffMcpFile.withEnabled(text, "files", false)
    expect(BuffMcpFile.servers(off)).toEqual({ files: { ...local, disabled: true } })
    expect(BuffMcpFile.servers(BuffMcpFile.withEnabled(off, "files", true))).toEqual({ files: local })
  })

  test("a broken file is not written over", () => {
    expect(() => BuffMcpFile.withServer("{ nope", "files", local)).toThrow("не читается")
  })
})
