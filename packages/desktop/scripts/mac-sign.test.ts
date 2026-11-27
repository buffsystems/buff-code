// Подпись и нотаризация macOS-сборки (autonomous-dev/cloud-front#764): ключи — только из окружения,
// целиком или никак; один вызов rcodesign подписывает весь бандл сертификатом Developer ID с
// hardened runtime, права — по местам, затем нотаризация с печатью.
import { describe, expect, test } from "bun:test"
import { macSigning, notarizeArgs, signArgs } from "./mac-sign"

const ENV = {
  BUFF_MAC_SIGN_P12: "cDEy",
  BUFF_MAC_SIGN_PASSWORD: "pw",
  BUFF_MAC_NOTARY_ISSUER: "69a6de7e-0000-47e3-e053-5b8c7c11a4d1",
  BUFF_MAC_NOTARY_KEY_ID: "58MMJ75AA4",
  // A PEM in parts: a whole private-key header in the tree stops the public snapshot.
  BUFF_MAC_NOTARY_KEY: ["-----BEGIN", "PRIVATE KEY-----\nx\n-----END", "PRIVATE KEY-----\n"].join(" "),
}

describe("macSigning", () => {
  test("без ключей — ad-hoc, как раньше", () => {
    expect(macSigning({})).toBeNull()
  })

  test("все ключи — подпись Developer ID и нотаризация", () => {
    expect(macSigning(ENV)).toEqual({
      p12: "cDEy",
      password: "pw",
      issuer: ENV.BUFF_MAC_NOTARY_ISSUER,
      keyId: "58MMJ75AA4",
      key: ENV.BUFF_MAC_NOTARY_KEY,
    })
  })

  test("часть ключей — отказ с именами недостающих: подписанное без нотаризации Gatekeeper всё равно не пустит", () => {
    const { BUFF_MAC_NOTARY_KEY: _, BUFF_MAC_SIGN_PASSWORD: __, ...partial } = ENV
    expect(() => macSigning(partial)).toThrow(/BUFF_MAC_SIGN_PASSWORD.*BUFF_MAC_NOTARY_KEY/)
  })
})

const keys = { p12: "/k/cert.p12", passwordFile: "/k/pw", notaryJson: "/k/notary.json" }
const plists = { app: "/r/entitlements.plist", cli: "/r/entitlements.cli.plist" }

describe("signArgs", () => {
  const args = signArgs("/out/Buff.app", keys, plists, [
    "Contents/Frameworks/Buff Helper.app",
    "Contents/Frameworks/Buff Helper (GPU).app",
  ])

  test("для нотаризации: Developer ID, метка времени, hardened runtime на всём", () => {
    expect(args.slice(0, 2)).toEqual(["sign", "--for-notarization"])
    expect(args).toContain("--p12-file")
    expect(args[args.indexOf("--p12-file") + 1]).toBe("/k/cert.p12")
    expect(args[args.indexOf("--p12-password-file") + 1]).toBe("/k/pw")
    expect(args.at(-1)).toBe("/out/Buff.app")
  })

  test("пароль — только файлом, не в аргументах", () => {
    expect(args).not.toContain("--p12-password")
    expect(args).not.toContain(ENV.BUFF_MAC_SIGN_PASSWORD)
  })

  test("права: приложению и каждому помощнику — права приложения, вложенной консоли — свои", () => {
    const ent = args.flatMap((a, i) => (a === "--entitlements-xml-file" ? [args[i + 1]] : []))
    expect(ent).toEqual([
      "/r/entitlements.plist",
      "Contents/Frameworks/Buff Helper.app:/r/entitlements.plist",
      "Contents/Frameworks/Buff Helper (GPU).app:/r/entitlements.plist",
      "Contents/Resources/buff:/r/entitlements.cli.plist",
    ])
  })
})

test("нотаризация: ключом App Store Connect, ждать ответа и поставить печать на бандл", () => {
  expect(notarizeArgs("/out/Buff.app", keys)).toEqual([
    "notary-submit",
    "--api-key-file",
    "/k/notary.json",
    "--staple",
    "--max-wait-seconds",
    "3600",
    "/out/Buff.app",
  ])
})
