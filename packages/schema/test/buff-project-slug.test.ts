// Папка проекта (#969): человек называет проект как хочет, папка — латиницей, без пробелов.
import { describe, expect, test } from "bun:test"
import { BuffProjectSlug } from "../src/buff-project-slug.js"

describe("the folder's name", () => {
  test("Cyrillic is transliterated, everything else that is not a letter or a digit becomes a dash", () => {
    expect(BuffProjectSlug.of("Сайт кофейни")).toBe("sajt-kofejni")
    expect(BuffProjectSlug.of("  Q3 Report: v2!  ")).toBe("q3-report-v2")
    expect(BuffProjectSlug.of("Щука & Ёж / Юла")).toBe("schuka-ezh-yula")
    expect(BuffProjectSlug.of("объём")).toBe("obem")
  })

  test("a name with nothing to keep is «project»; a long one is cut on a word", () => {
    expect(BuffProjectSlug.of("★★★")).toBe("project")
    expect(BuffProjectSlug.of("漢字")).toBe("project")
    const long = BuffProjectSlug.of("очень длинное название проекта для проверки обрезки по слову а не посередине")
    expect(long.length).toBeLessThanOrEqual(BuffProjectSlug.MAX)
    expect(long.endsWith("-")).toBe(false)
    expect(long).toBe("ochen-dlinnoe-nazvanie-proekta-dlya-proverki")
  })

  test("a taken name gets a number; case does not tell folders apart", () => {
    expect(BuffProjectSlug.of("Shop", ["shop"])).toBe("shop-2")
    expect(BuffProjectSlug.of("Shop", ["Shop", "shop-2", "shop-3"])).toBe("shop-4")
    expect(BuffProjectSlug.of("Shop", ["other"])).toBe("shop")
  })

  test("a name never leaves the folder it is made in", () => {
    for (const name of ["..", "../etc", "a/../../b", ".hidden", "/abs"]) {
      const slug = BuffProjectSlug.of(name)
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})
