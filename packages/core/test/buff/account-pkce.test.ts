// Вход в личный аккаунт Buff (#966): PKCE, адрес страницы и разбор возврата — без сети.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { BuffAccountPkce } from "../../src/buff/account/pkce"

describe("PKCE (RFC 7636, S256)", () => {
  test("проверочная строка — 43 знака разрешённого набора, каждый раз новая", () => {
    const a = BuffAccountPkce.verifier()
    expect(a).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
    expect(BuffAccountPkce.verifier()).not.toBe(a)
  })

  test("отпечаток — base64url без дополнения от SHA-256; пример из RFC 7636", () => {
    expect(BuffAccountPkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    )
    const verifier = BuffAccountPkce.verifier()
    const challenge = BuffAccountPkce.challenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"))
  })

  test("state — не короче 128 бит, годится в адрес", () => {
    const state = BuffAccountPkce.state()
    expect(state).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(BuffAccountPkce.state()).not.toBe(state)
  })
})

describe("адреса", () => {
  test("без переменных — buff.systems и code.buff.systems", () => {
    expect(BuffAccountPkce.host({})).toBe("buff.systems")
    expect(BuffAccountPkce.webOrigin({})).toBe("https://code.buff.systems")
  })

  test("стенд: сайт аккаунта и веб-клиент задаются своими переменными", () => {
    const env = { BUFF_ACCOUNT_HOST: "dev.buff.systems", BUFF_ACCOUNT_WEB: "https://code.dev.buff.systems/" }
    expect(BuffAccountPkce.host(env)).toBe("dev.buff.systems")
    expect(BuffAccountPkce.webOrigin(env)).toBe("https://code.dev.buff.systems")
    expect(BuffAccountPkce.webOrigin({ BUFF_ACCOUNT_HOST: "dev.buff.systems" })).toBe("https://code.dev.buff.systems")
    expect(BuffAccountPkce.webOrigin({ BUFF_ACCOUNT_WEB: "localhost:5173" })).toBe("https://localhost:5173")
  })

  const base = {
    origin: "https://code.buff.systems",
    challenge: "c".repeat(43),
    state: "st",
    device: "MacBook Ивана & Co",
    pubkey: "pk",
  }

  test("страница входа с возвратом на этот компьютер: порт в адресе, значения закодированы", () => {
    const url = new URL(BuffAccountPkce.authorizeURL({ ...base, return: { type: "loopback", port: 49152 } }))
    expect(url.origin + url.pathname).toBe("https://code.buff.systems/authorize")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      challenge: "c".repeat(43),
      state: "st",
      device: "MacBook Ивана & Co",
      pubkey: "pk",
      return: "loopback",
      port: "49152",
    })
    expect(url.search).not.toContain("&Co")
    expect(url.search).not.toContain("Ивана")
  })

  test("страница входа с кодом для вставки: порта нет", () => {
    const url = new URL(BuffAccountPkce.authorizeURL({ ...base, return: { type: "paste" } }))
    expect(url.searchParams.get("return")).toBe("paste")
    expect(url.searchParams.has("port")).toBe(false)
  })
})

describe("возврат на 127.0.0.1", () => {
  test("свой state и код — берём код", () => {
    expect(BuffAccountPkce.callback("GET", "/callback?code=bufa_ABC&state=st", "st")).toEqual({
      type: "code",
      code: "bufa_ABC",
    })
  })

  test("человек нажал «Отклонить» — отказ", () => {
    expect(BuffAccountPkce.callback("GET", "/callback?error=access_denied&state=st", "st")).toEqual({ type: "denied" })
  })

  test("чужой state, другой путь или метод — не наш запрос: вход ни принимается, ни срывается", () => {
    expect(BuffAccountPkce.callback("GET", "/callback?code=bufa_ABC&state=other", "st")).toEqual({
      type: "stranger",
      reason: "state",
    })
    expect(BuffAccountPkce.callback("GET", "/callback?code=bufa_ABC", "st")).toEqual({
      type: "stranger",
      reason: "state",
    })
    expect(BuffAccountPkce.callback("GET", "/callback?error=access_denied&state=other", "st")).toEqual({
      type: "stranger",
      reason: "state",
    })
    expect(BuffAccountPkce.callback("GET", "/favicon.ico", "st")).toEqual({ type: "stranger", reason: "path" })
    expect(BuffAccountPkce.callback("POST", "/callback?code=bufa_ABC&state=st", "st")).toEqual({
      type: "stranger",
      reason: "path",
    })
    expect(BuffAccountPkce.callback("GET", "/callback?state=st", "st")).toEqual({ type: "stranger", reason: "empty" })
  })
})

describe("вставленная строка «код#state»", () => {
  test("делится по последней решётке; пробелы по краям не мешают", () => {
    expect(BuffAccountPkce.pasted("  bufa_ABC#st \n", "st")).toEqual({ type: "code", code: "bufa_ABC" })
    expect(BuffAccountPkce.pasted("bufa_A#B#st", "st")).toEqual({ type: "code", code: "bufa_A#B" })
  })

  test("чужой state или строка без решётки — не принимается", () => {
    expect(BuffAccountPkce.pasted("bufa_ABC#other", "st")).toEqual({ type: "stranger", reason: "state" })
    expect(BuffAccountPkce.pasted("bufa_ABC", "st")).toEqual({ type: "stranger", reason: "empty" })
    expect(BuffAccountPkce.pasted("#st", "st")).toEqual({ type: "stranger", reason: "empty" })
    expect(BuffAccountPkce.pasted("", "st")).toEqual({ type: "stranger", reason: "empty" })
  })
})

describe("можно ли открыть браузер на этом компьютере", () => {
  test("SSH, WSL и Linux без графики — нельзя", () => {
    expect(BuffAccountPkce.headless({ SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" }, "darwin")).toBe(true)
    expect(BuffAccountPkce.headless({ DISPLAY: ":0", WSL_DISTRO_NAME: "Ubuntu" }, "linux")).toBe(true)
    expect(BuffAccountPkce.headless({ DISPLAY: ":0" }, "linux", "5.15.90.1-microsoft-standard-WSL2")).toBe(true)
    expect(BuffAccountPkce.headless({}, "linux")).toBe(true)
  })

  test("рабочий стол — можно", () => {
    expect(BuffAccountPkce.headless({}, "darwin")).toBe(false)
    expect(BuffAccountPkce.headless({}, "win32")).toBe(false)
    expect(BuffAccountPkce.headless({ DISPLAY: ":0" }, "linux", "6.8.0-generic")).toBe(false)
    expect(BuffAccountPkce.headless({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(false)
  })
})
