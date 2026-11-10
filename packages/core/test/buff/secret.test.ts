// Хранилище секретов (#765): значение внутрь, ссылка наружу; подстановка в настройки подключения.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BuffSecret } from "../../src/buff/secret"
import { fakeKV } from "./fake-kv"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("the secret store", () => {
  test("put returns a reference, the value stays in the store under the id", async () => {
    const kv = fakeKV()
    const secrets = BuffSecret.make(kv)
    const reference = await run(secrets.put("hunter2"))
    expect(reference.startsWith("secret:sec_")).toBe(true)
    const id = reference.slice("secret:".length)
    expect(await run(secrets.get(id))).toBe("hunter2")
    expect([...kv.data.keys()]).toEqual([`buff.secret:${id}`])
    await run(secrets.remove(id))
    expect(await run(secrets.get(id))).toBeUndefined()
  })
})

describe("substituting secrets into a connection", () => {
  const lookup = (id: string) => ({ sec_1: "p4ss", sec_2: "tok" })[id]
  test("a local server gets them in its command and environment", () => {
    const resolved = BuffSecret.substitute(
      { type: "local", command: ["srv", "--password={secret:sec_1}"], environment: { TOKEN: "{secret:sec_2}" } },
      lookup,
    )
    expect(resolved).toEqual({
      type: "local",
      command: ["srv", "--password=p4ss"],
      environment: { TOKEN: "tok" },
    })
  })
  test("a remote server gets them in headers, url and OAuth client secret", () => {
    const resolved = BuffSecret.substitute(
      {
        type: "remote",
        url: "https://x.example/{secret:sec_2}/mcp",
        headers: { Authorization: "Bearer {secret:sec_2}" },
        oauth: { client_id: "id", client_secret: "{secret:sec_1}" },
      },
      lookup,
    )
    expect(resolved).toEqual({
      type: "remote",
      url: "https://x.example/tok/mcp",
      headers: { Authorization: "Bearer tok" },
      oauth: { client_id: "id", client_secret: "p4ss" },
    })
  })
  test("a missing secret fails the start by name instead of starting with an empty value", () => {
    const resolved = BuffSecret.substitute(
      { type: "remote", url: "https://x.example/mcp", headers: { Authorization: "{secret:sec_gone}" } },
      lookup,
    )
    expect(resolved).toBeInstanceOf(BuffSecret.MissingError)
    expect((resolved as BuffSecret.MissingError).message).toContain("{secret:sec_gone}")
  })
  test("referenced lists every id once, OAuth included", () => {
    expect(
      BuffSecret.referenced({
        type: "remote",
        url: "https://x.example/mcp",
        headers: { A: "{secret:sec_1}", B: "{secret:sec_1}" },
        oauth: { client_secret: "{secret:sec_2}" },
      }),
    ).toEqual(["sec_1", "sec_2"])
    expect(BuffSecret.referenced({ type: "local", command: ["srv"] })).toEqual([])
  })
})
