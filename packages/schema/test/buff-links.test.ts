// Ссылки на сайт по языку (#720): русский — прежние адреса, английский — под /en.
import { describe, expect, test } from "bun:test"
import { BuffLinks } from "../src/buff-links.js"

describe("localized", () => {
  test("Russian keeps the address", () => {
    expect(BuffLinks.localized(BuffLinks.docs, "ru")).toBe("https://buff.systems/docs/buff-code")
  })

  test("English pages go under /en", () => {
    expect(BuffLinks.localized(BuffLinks.docs, "en")).toBe("https://buff.systems/en/docs/buff-code")
    expect(BuffLinks.localized(BuffLinks.signIn, "en")).toBe("https://buff.systems/en/docs/buff-code/sign-in")
    expect(BuffLinks.localized(BuffLinks.site, "en")).toBe("https://buff.systems/en")
    expect(BuffLinks.localized("https://buff.systems/", "en")).toBe("https://buff.systems/en")
    expect(BuffLinks.localized("https://buff.systems/#contact", "en")).toBe("https://buff.systems/en#contact")
    expect(BuffLinks.localized("https://buff.systems/pricing?x=1#a", "en")).toBe("https://buff.systems/en/pricing?x=1#a")
    expect(BuffLinks.localized(BuffLinks.downloads, "en")).toBe("https://buff.systems/en/downloads")
  })

  test("what is not a page stays as it is", () => {
    for (const href of [
      BuffLinks.changelog,
      BuffLinks.latestCli,
      BuffLinks.support,
      "https://buff.systems/install",
      "https://buff.systems/app/device?code=AAAA",
      "https://buff.systems/api/x",
      "https://buff.systems/og/docs",
      "https://buff.systems/downloads/1.2.3/SHA256SUMS",
      "https://buff.systems/llms.txt",
      "https://buff.systems/en/docs/buff-code",
      "https://buff.systems.example.com/docs",
      "https://github.com/buffsystems/buff-code",
    ])
      expect(BuffLinks.localized(href, "en")).toBe(href)
  })
})
