// Инструменты подключений (#765): подтверждения, слова для модели, универсальность описаний.
import { describe, expect, test } from "bun:test"
import { BuffConnection } from "@opencode/schema/buff-connection"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { Mcp as McpSchema } from "@opencode/schema/mcp"
import { Schema } from "effect"
import { BuffConnectionPlugin } from "../../src/buff/connection"
import { BuffConnectionText } from "../../src/buff/connection-text"

const ru = (text: string, params?: BuffI18n.Params) => BuffI18n.t("ru", text, params)
const SERVICE_WORDS = /\b(gmail|google|figma|slack|notion|jira|imap|smtp|outlook|dropbox|github|telegram|yandex)\b/i

describe("the person confirms saving and removing", () => {
  test("a local connection: run line, environment names, secret count — in Russian", () => {
    expect(
      BuffConnection.saveConfirmation(
        {
          name: "mail",
          scope: "user",
          config: {
            type: "local",
            command: ["srv", "--x"],
            environment: { TOKEN: "{secret:sec_1}", MODE: "ro" },
          },
        },
        ru,
      ),
    ).toEqual([
      "Сохранить подключение «mail» для: все проекты",
      "Запуск: srv --x",
      "Переменные окружения: TOKEN, MODE",
      "Использует введённые вами секреты: 1",
    ])
  })
  test("a remote connection: address, headers, OAuth note", () => {
    expect(
      BuffConnection.saveConfirmation(
        { name: "r", scope: "project", config: { type: "remote", url: "https://x.example/mcp", headers: { A: "1" } } },
        BuffI18n.english,
      ),
    ).toEqual([
      "Save connection «r» for this project",
      "Address: https://x.example/mcp",
      "Headers: A",
      "Sign-in through the service (OAuth) when needed",
    ])
    expect(BuffConnection.removeConfirmation({ name: "r", secrets: 2 }, ru)).toEqual([
      "Удалить подключение «r»",
      "Его секреты тоже удаляются: 2",
    ])
  })
  test("allowed by any rule — still asked; denied stays denied", () => {
    expect(BuffConnectionPlugin.confirmed({ action: BuffConnection.SAVE_ACTION, effect: "allow" })).toBe("ask")
    expect(BuffConnectionPlugin.confirmed({ action: BuffConnection.REMOVE_ACTION, effect: "deny" })).toBe("deny")
    expect(BuffConnectionPlugin.confirmed({ action: "edit", effect: "allow" })).toBe("allow")
  })
  test("the sign-in state comes from the authorization address; the app link is the phone's return (#780)", () => {
    expect(BuffConnection.oauthState("https://a.example/authorize?client_id=x&state=st-1&code_challenge=c")).toBe(
      "st-1",
    )
    expect(BuffConnection.oauthState("https://a.example/authorize")).toBeUndefined()
    expect(BuffConnection.oauthState("not a url")).toBeUndefined()
    expect(BuffConnection.APP_LINK).toMatch(/^buff:\/\//)
  })
  test("the skill id of a connection is a valid skill id", () => {
    expect(BuffConnection.skillID("My_Mail 2")).toBe("connection-my-mail-2")
    expect(BuffConnection.skillID("---")).toBe("connection-x")
  })
})

describe("permission metadata", () => {
  test("a server config decoded into a schema class becomes plain JSON for the permission request (e2e bug)", () => {
    const decoded = Schema.decodeUnknownSync(McpSchema.ServerConfig)({
      type: "remote",
      url: "https://x.example/mcp",
      oauth: false,
    })
    expect(decoded instanceof McpSchema.RemoteConfig).toBe(true)
    const copy = BuffConnectionPlugin.plain(decoded)
    expect(copy instanceof McpSchema.RemoteConfig).toBe(false)
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(copy).toEqual({ type: "remote", url: "https://x.example/mcp", oauth: false })
  })
})

describe("what the model hears", () => {
  const tools = [
    { server: "mail", name: "search", description: "Search letters\nmore" },
    { server: "mail", name: "read" },
    { server: "other", name: "x" },
  ]
  test("the list: scope, kind, status in words, tools per connection", () => {
    const text = BuffConnectionText.list(
      [
        {
          name: "mail",
          scope: "user",
          config: { type: "local", command: ["srv"] },
          status: { status: "connected" },
        },
        {
          name: "r",
          scope: "project",
          config: { type: "remote", url: "https://x.example", oauth: false },
          status: { status: "failed", error: "fetch failed: ECONNREFUSED" },
        },
        { name: "buff", scope: "builtin", status: { status: "needs_auth", error: "Unauthorized" } },
      ],
      tools,
    )
    expect(text).toContain("- mail (user; local): Connected\n  tools (2): search, read")
    expect(text).toContain("- r (project; remote, key): Did not start: The server at this address does not respond.")
    expect(text).toContain("(fetch failed: ECONNREFUSED)")
    expect(text).toContain("- buff (built-in, not editable): Sign-in needed: Unauthorized")
    expect(BuffConnectionText.list([], [])).toBe("No connections yet.")
  })
  test("a status report lists tools with one-line descriptions only when connected", () => {
    expect(BuffConnectionText.status("mail", { status: "connected" }, tools.slice(0, 2))).toBe(
      "Connection «mail»: Connected. Tools (2):\n- search — Search letters\n- read",
    )
    expect(BuffConnectionText.status("mail", { status: "pending" }, [])).toBe("Connection «mail»: Connecting…")
  })
  test("a trial call result: ok or error, text shortened", () => {
    expect(
      BuffConnectionText.callResult({
        server: "mail" as never,
        tool: "search",
        isError: false,
        content: [{ type: "text", text: "3 letters" }],
      }),
    ).toBe("ok — 3 letters")
    expect(BuffConnectionText.callResult({ server: "mail" as never, tool: "x", isError: true, content: [] })).toBe(
      "error — (no details)",
    )
    const long = BuffConnectionText.callResult({
      server: "m" as never,
      tool: "x",
      isError: false,
      content: [{ type: "text", text: "a".repeat(2500) }],
    })
    expect(long.length).toBeLessThan(2100)
    expect(long.endsWith("… (shortened)")).toBe(true)
  })
  test("no service names in any tool description", () => {
    for (const text of Object.values(BuffConnectionPlugin.descriptions)) expect(text).not.toMatch(SERVICE_WORDS)
  })
})
