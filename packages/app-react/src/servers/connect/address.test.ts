import { describe, expect, test } from "bun:test"
import { decodePairingCode } from "./address"

// Код сопряжения из `buff pair` (#628): новые выпуски несут имя buff, прежние — opencode;
// оба кода сопрягают, чужое имя — нет.
describe("decodePairingCode", () => {
  const code = (username: string) =>
    JSON.stringify({ urls: ["http://192.168.1.5:49374"], username, password: "secret" })

  test("takes the buff username", () => {
    expect(decodePairingCode(code("buff"))).toEqual({ urls: ["http://192.168.1.5:49374"], password: "secret" })
  })

  test("still takes a code with the legacy opencode username", () => {
    expect(decodePairingCode(code("opencode"))).toEqual({ urls: ["http://192.168.1.5:49374"], password: "secret" })
  })

  test("rejects any other username", () => {
    expect(decodePairingCode(code("custom"))).toBeUndefined()
  })
})
