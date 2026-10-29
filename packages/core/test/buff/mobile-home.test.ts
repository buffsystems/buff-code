// Домашняя установка машины (#639): по каждой организации из токена — ответ установки через
// коннектор; запретившая телефоны важнее, коннектор без такого вопроса — машина без дома.
import { describe, expect, test } from "bun:test"
import { lookupHome, tokenOrgs } from "../../src/buff/mobile/home"

const token = (orgs: string[]) =>
  ["h", Buffer.from(JSON.stringify({ sub: "ivan", orgs })).toString("base64url"), "s"].join(".")

describe("home install", () => {
  test("the organisations are read from the developer's token", () => {
    expect(tokenOrgs(token(["acme", "retail"]))).toEqual(["acme", "retail"])
    expect(tokenOrgs("not-a-token")).toEqual([])
  })

  test("an organisation that forbids phones is the home; otherwise the first that answered", async () => {
    const asked: string[] = []
    const answers: Record<string, unknown> = {
      acme: { ok: true, home: "peer-acme", kind: "saas", name: "acme", pairing_disabled: false },
      retail: { ok: true, home: "peer-retail", kind: "saas", name: "retail", pairing_disabled: true },
    }
    const post = async (url: string, body: object) => {
      const org = (body as { org: string }).org
      asked.push(`${url} ${org}`)
      return { status: 200, json: answers[org] }
    }
    const me = { token: token(["acme", "retail"]), connector: "https://gw" }
    expect(await lookupHome(me, post)).toEqual({ peer: "peer-retail", name: "retail", kind: "saas", forbidden: true })
    expect(asked).toEqual(["https://gw/v1/developer/mobile-home acme", "https://gw/v1/developer/mobile-home retail"])
    answers.retail = { ok: true, home: "peer-retail", kind: "saas", name: "retail", pairing_disabled: false }
    expect(await lookupHome(me, post)).toEqual({ peer: "peer-acme", name: "acme", kind: "saas", forbidden: false })
  })

  test("a connector that does not know the question, or does not answer, leaves the machine without a home", async () => {
    const me = { token: token(["acme"]), connector: "https://gw" }
    expect(await lookupHome(me, async () => ({ status: 404, json: { error: "not found" } }))).toBeNull()
    expect(
      await lookupHome(me, async () => {
        throw new Error("ECONNREFUSED")
      }),
    ).toBeNull()
  })
})
