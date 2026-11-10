// Секреты (#765): ссылка для модели, подстановка для подключения, раскрытие по хранилищу.
import { describe, expect, test } from "bun:test"
import { BuffSecret } from "../src/buff-secret.js"

describe("secret references", () => {
  test("a fresh id, its reference and its token agree", () => {
    const id = BuffSecret.createID()
    expect(id.startsWith("sec_")).toBe(true)
    expect(BuffSecret.ref(id)).toBe(`secret:${id}`)
    expect(BuffSecret.isRef(BuffSecret.ref(id))).toBe(true)
    expect(BuffSecret.idOf(BuffSecret.ref(id))).toBe(id)
    expect(BuffSecret.token(id)).toBe(`{secret:${id}}`)
  })
  test("a plain value or an empty reference is not a reference", () => {
    expect(BuffSecret.isRef("hunter2")).toBe(false)
    expect(BuffSecret.isRef("secret:")).toBe(false)
    expect(BuffSecret.isRef(42)).toBe(false)
  })
})

describe("expanding tokens", () => {
  const lookup = (id: string) => ({ sec_a: "alpha", sec_b: "beta" })[id]
  test("every token in the text is replaced by its value", () => {
    expect(BuffSecret.tokensIn("Bearer {secret:sec_a} and {secret:sec_b}")).toEqual(["sec_a", "sec_b"])
    expect(BuffSecret.expand("Bearer {secret:sec_a}", lookup)).toBe("Bearer alpha")
    expect(BuffSecret.expand("no tokens", lookup)).toBe("no tokens")
  })
  test("an unknown id is reported, never replaced by an empty string", () => {
    expect(BuffSecret.expand("x {secret:sec_zzz} y", lookup)).toEqual({ missing: "sec_zzz" })
  })
})
