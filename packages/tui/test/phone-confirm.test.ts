// Seen live (#640): by QR the console asked to compare a code the phone never shows — the QR
// carried the secret. By QR it asks to confirm the phone itself; by link and code, the SAS.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { adoptLocale, currentLocale } from "../src/feature-plugins/buff/locale-state"
import { pairConfirm } from "../src/feature-plugins/buff/phone-note"

// The words are compared in English; the process language defaults to Russian (#472) and is one
// for the whole test run — it goes back afterwards.
const before = currentLocale()
beforeAll(() => adoptLocale("en"))
afterAll(() => adoptLocale(before))

describe("pairConfirm", () => {
  test("by QR: confirm the phone by its name, no code", () => {
    expect(pairConfirm("qr", "Pixel", "482913")).toEqual({
      prompt: "The phone «Pixel» asks to connect by the QR code. If it is your phone, press Enter.",
      keys: "Enter — it is my phone · n — not my phone",
    })
  })
  test("by link and code: compare the six digits", () => {
    expect(pairConfirm("code", "Pixel", "482913")).toEqual({
      prompt: "The phone «Pixel» shows a code. If it is the same as this one, press Enter.",
      code: "482 913",
      keys: "Enter — it matches · n — not my phone",
    })
  })
})
