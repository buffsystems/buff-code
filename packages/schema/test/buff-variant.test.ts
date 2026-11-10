// Режим размышлений (#759): варианты модели словами — и в окне, и в консоли; раньше окно
// показывало голые id (Default/Medium/High), и было непонятно, что они меняют.
import { expect, test } from "bun:test"
import { BuffVariant } from "../src/buff-variant.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

test("every known variant has a label and a hint, in English and Russian", () => {
  for (const id of ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    expect(BuffVariant.label(id)).not.toBe(id)
    expect(BuffVariant.hint(id).length).toBeGreaterThan(0)
    expect(BuffVariant.label(id, ru)).not.toBe(BuffVariant.label(id))
    expect(BuffVariant.hint(id, ru)).not.toBe(BuffVariant.hint(id))
  }
  expect(BuffVariant.label("high")).toBe("High")
  expect(BuffVariant.label("high", ru)).toBe("Высокие")
})

test("an unknown variant shows as it is, without a hint", () => {
  expect(BuffVariant.label("turbo")).toBe("turbo")
  expect(BuffVariant.hint("turbo")).toBe("")
})

test("the control names what it sets", () => {
  expect(BuffVariant.TITLE).toBe("Thinking mode")
  expect(ru(BuffVariant.TITLE)).toBe("Режим размышлений")
})
