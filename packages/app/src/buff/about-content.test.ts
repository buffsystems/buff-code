// Страница «About» в Buff Code (#462): о нашем продукте и с нашими адресами, а происхождение от
// OpenCode названо — этого требует его лицензия.
import { expect, test } from "bun:test"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffLinks } from "@opencode/schema/buff-links"
import { aboutContent } from "./about-content"

// #472: слова — английские исходные; ожидания — по-русски, через общий каталог.
const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)
const about = aboutContent("2.0.11-buff.16", ru)
const text = JSON.stringify(about)

test("it is about Buff Code and its version", () => {
  expect(about.version).toBe("Версия 2.0.11-buff.16")
  expect(about.description).toContain("Buff")
})

test("a build without a version says so instead of showing a blank", () => {
  expect(aboutContent(undefined, ru).version).toBe("Версия для разработки")
  expect(aboutContent(undefined).version).toBe("Development build")
})

test("every link is ours", () => {
  expect(about.links.map((link) => link.href)).toEqual([BuffLinks.site, BuffLinks.docs, BuffLinks.support])
  expect(text).not.toContain("opencode.ai")
  expect(text).not.toContain("github.com")
})

test("the origin is credited: the project, its licence, its owner and its trademark", () => {
  const origin = about.origin.join(" ")
  expect(origin).toContain("OpenCode")
  expect(origin).toContain("MIT")
  expect(origin).toContain("Anomaly Innovations, Inc.")
  expect(origin).toContain("товарный знак")
})
