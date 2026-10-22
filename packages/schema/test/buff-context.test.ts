// Общие правила рабочего контекста (#391) — одни для терминала и десктопа.
import { expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffContext } from "../src/buff-context.js"

// #472: строки схемы — английские исходные; ожидания — по-русски, через общий каталог.
const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)

test("the label every screen shows", () => {
  expect(BuffContext.label({ org: "acme", project: "shop", spaces: ["handbook"] }, ru)).toBe("acme › shop · 1 пр.")
  expect(BuffContext.label({ org: "acme", project: null, spaces: [] }, ru)).toBe("acme › без проекта")
  expect(BuffContext.label(null, ru)).toBe("контекст не выбран")
})

test("what the project choice preselects", () => {
  expect(BuffContext.preselectProject(null, "acme")).toBeUndefined() // first run: nothing
  expect(BuffContext.preselectProject({ org: "acme", project: "shop", spaces: [] }, "acme")).toBe("shop")
  expect(BuffContext.preselectProject({ org: "acme", project: null, spaces: [] }, "acme")).toBeNull()
  expect(BuffContext.preselectProject({ org: "retail", project: "pos", spaces: [] }, "acme")).toBeUndefined()
})
