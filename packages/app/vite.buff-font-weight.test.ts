// Веса шрифта (#471): шкала апстрима (подбор под Inter) приводится к шкале кабинета Buff.
import { expect, test } from "bun:test"
import { cabinetFontWeights } from "./vite.buff-font-weight.js"

test("upstream regular and medium weights become the cabinet's 400 and 500", () => {
  expect(cabinetFontWeights(".a{font-weight:440;color:red}")).toBe(".a{font-weight:400;color:red}")
  expect(cabinetFontWeights(".b { font-weight: 530; }")).toBe(".b { font-weight: 500; }")
  expect(cabinetFontWeights(".c{font-weight:540}.d{font-weight:640}")).toBe(".c{font-weight:500}.d{font-weight:600}")
})

test("the cabinet's own weights and other numbers stay as they are", () => {
  const css = ".a{font-weight:400}.b{font-weight:600}.c{line-height:440px}.d{font-weight:bold}"
  expect(cabinetFontWeights(css)).toBe(css)
})
