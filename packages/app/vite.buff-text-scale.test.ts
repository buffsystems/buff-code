// Размер шрифта (#461): размеры в стилях становятся «размер × множитель», код — своим размером.
import { expect, test } from "bun:test"
import { scaleFontSizes } from "./vite.buff-text-scale.js"

test("interface text is scaled by the interface factor", () => {
  expect(scaleFontSizes(".a{font-size:13px;color:red}")).toBe(
    ".a{font-size:calc(13px * var(--buff-ui-scale, 1));color:red}",
  )
  expect(scaleFontSizes(".b { font-size: 0.875rem; }")).toBe(
    ".b { font-size: calc(0.875rem * var(--buff-ui-scale, 1)); }",
  )
})

test("theme size variables are scaled where they are defined", () => {
  expect(scaleFontSizes(":root{--font-size-base: 14px;--text-sm:0.875rem}")).toBe(
    ":root{--font-size-base: calc(14px * var(--buff-ui-scale, 1));--text-sm:calc(0.875rem * var(--buff-ui-scale, 1))}",
  )
})

test("monospace blocks get the code size instead", () => {
  expect(scaleFontSizes("pre code{font-family:var(--font-family-mono);font-size:12px}")).toBe(
    "pre code{font-family:var(--font-family-mono);font-size:var(--buff-code-font-size, 12px)}",
  )
})

test("relative sizes and already computed ones are left alone", () => {
  const css = ".c{font-size:inherit}.d{font-size:1.2em}.e{font-size:var(--font-size-small)}"
  expect(scaleFontSizes(css)).toBe(css)
  expect(scaleFontSizes(scaleFontSizes(".a{font-size:13px}"))).toBe(scaleFontSizes(".a{font-size:13px}"))
})
