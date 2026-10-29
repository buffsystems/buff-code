import { describe, expect, test } from "bun:test"
import { BuffMobile } from "@opencode/schema/buff-mobile"
import { blockOf, homeOf, offerFits, pairingSlot, phaseOf, phoneRows } from "./phone-model"

const offer = (over: Partial<BuffMobile.Offer>): BuffMobile.Offer => ({
  offerId: "o",
  state: "offered",
  kind: "code",
  link: "https://buff.systems/p/x",
  code: "ABCD-EFGH",
  expiresAt: 1_000,
  ...over,
})

test("an offer counts down, shows its bare code, and runs out", () => {
  expect(phaseOf(offer({}), 940)).toEqual({
    kind: "offer",
    offer: { link: "https://buff.systems/p/x", code: "ABCDEFGH", ttlSeconds: 900 },
    secondsLeft: 60,
  })
  expect(phaseOf(offer({}), 1_000)).toEqual({ kind: "expired" })
  expect(phaseOf(offer({ state: "failed" }), 0)).toEqual({ kind: "expired" })
})

test("a phone that revealed is confirmed here by its code; a paired one is done", () => {
  expect(phaseOf(offer({ state: "sas", sas: "123456", phone: "Pixel" }), 0)).toEqual({
    kind: "claimed",
    sas: "123456",
    device: { name: "Pixel", model: "" },
  })
  expect(phaseOf(offer({ state: "paired", phone: "Pixel" }), 0)).toEqual({
    kind: "paired",
    device: { name: "Pixel", model: "" },
  })
  expect([
    BuffMobile.isLive(offer({ state: "claimed" })),
    BuffMobile.isLive(offer({ state: "paired" })),
    BuffMobile.isLive(null),
  ]).toEqual([true, false, false])
})

test("a phone row says whether it is on the line and when it was last heard", () => {
  const [on, off] = phoneRows(
    [
      { device: "d1", display: "Pixel", paired: 1_700_000_000, online: true, seen: 1_700_000_100 },
      { device: "d2", display: "iPhone", paired: 1_700_000_000, online: false, seen: null },
    ],
    "en",
  )
  expect([on!.id, on!.name, on!.status]).toEqual(["d1", "Pixel", "online"])
  expect([off!.status, off!.lastSeen]).toEqual(["offline", "—"])
})

test("a home install that forbids phones blocks pairing, named the way it applies", () => {
  const status = (home: BuffMobile.Status["home"], running = true): BuffMobile.Status => ({
    gateway: "buff.systems",
    connected: true,
    problem: null,
    phones: 0,
    running,
    home,
  })
  expect(blockOf(status(null, false))).toBe("serviceDown")
  expect(blockOf(status(null))).toBeNull()
  expect(blockOf(status({ name: "acme", kind: "saas", forbidden: true }))).toBe("org")
  expect(blockOf(status({ name: "buff.example.com", kind: "install", forbidden: true }))).toBe("ee")
  expect(homeOf(status(null))).toEqual({ kind: "standalone" })
  expect(homeOf(status({ name: "acme", kind: "saas", forbidden: false }))).toEqual({
    kind: "signedIn",
    install: "acme",
    policyForbids: false,
  })
})

// #670: the QR offer asked first can answer after the code offer asked on switching — a late
// answer of the other mode must not replace the offer of the tab on screen.
describe("offerFits", () => {
  test("an offer fits only the tab of its own kind", () => {
    expect(offerFits({ kind: "qr" }, "qr")).toBe(true)
    expect(offerFits({ kind: "code" }, "link")).toBe(true)
    expect(offerFits({ kind: "qr" }, "link")).toBe(false)
    expect(offerFits({ kind: "code" }, "qr")).toBe(false)
  })
})

test("a service that did not answer is said so, not drawn as an endless skeleton (#702)", () => {
  expect(pairingSlot({ phase: false, error: false, unreachable: false })).toBe("waiting")
  expect(pairingSlot({ phase: false, error: false, unreachable: true })).toBe("unreachable")
  expect(pairingSlot({ phase: false, error: true, unreachable: false })).toBe("retry")
  expect(pairingSlot({ phase: true, error: true, unreachable: true })).toBe("panel")
})
