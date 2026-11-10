// Код авторизации с телефона (#765): сам код или адрес страницы, куда отправил сервис.
import { describe, expect, test } from "bun:test"
import { McpOAuth } from "../../src/mcp/oauth"

describe("a pasted authorization code", () => {
  test("a bare code is taken as is; empty text is refused", () => {
    expect(McpOAuth.pastedCode("  abc.123  ", "st")).toEqual({ code: "abc.123" })
    expect(McpOAuth.pastedCode("", "st")).toEqual({ error: "Missing authorization code" })
  })
  test("an address carries the code; its state must match; iss is kept", () => {
    expect(
      McpOAuth.pastedCode("https://service.example/return?code=xyz&state=st&iss=https%3A%2F%2Fa.example", "st"),
    ).toEqual({
      code: "xyz",
      iss: "https://a.example",
    })
    expect(McpOAuth.pastedCode("https://service.example/return?code=xyz&state=other", "st")).toEqual({
      error: "OAuth state mismatch",
    })
    expect(McpOAuth.pastedCode("https://service.example/return?error=access_denied", "st")).toEqual({
      error: "access_denied",
    })
    expect(McpOAuth.pastedCode("https://service.example/return", "st")).toEqual({
      error: "The pasted address has no authorization code",
    })
  })
})
