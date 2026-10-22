import { describe, expect, test } from "bun:test"
import { contrastRatio } from "./color"
import { BUFF_FRAME, buffTheme, CABINET_TOKENS } from "./buff"
import { resolveThemeVariant } from "./resolve"
import type { DesktopTheme, HexColor, ResolvedV2Theme } from "./types"
import { resolveThemeV2 } from "./v2/resolve"

const base: DesktopTheme = await Bun.file(new URL("./themes/oc-2.json", import.meta.url)).json()
const theme = buffTheme(base)
const modes: ("light" | "dark")[] = ["light", "dark"]

const deref = (tokens: ResolvedV2Theme, key: string): string => {
  const value = tokens[key]!
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1]
  return ref ? deref(tokens, ref) : value
}
const hex = (value: string) => value.toLowerCase().slice(0, 7)
const v2 = (mode: "light" | "dark", key: string) => hex(deref(resolveThemeV2(theme)[mode], key))

describe("тема Buff — по кабинету", () => {
  test("подменяет oc-2 под тем же id и называется Buff", () => {
    expect(theme.id).toBe("oc-2")
    expect(theme.name).toBe("Buff")
  })

  test.each(modes)("%s: рамка окна — цвет колонки навигации кабинета", (mode) => {
    expect(BUFF_FRAME[mode]).toBe(CABINET_TOKENS[mode].muted)
    expect(v2(mode, "v2-background-bg-deep")).toBe(CABINET_TOKENS[mode].muted)
  })

  test.each(modes)("%s: слой v1 — фон, текст, границы кабинета", (mode) => {
    const cab = CABINET_TOKENS[mode]
    const tokens = resolveThemeVariant(theme[mode], mode === "dark")
    expect(tokens["background-base"]).toBe(cab.background)
    expect(tokens["text-strong"]).toBe(cab.foreground)
    expect(tokens["text-base"]).toBe(cab.mutedForeground)
    expect(tokens["border-weak-base"]).toBe(cab.border)
    expect(tokens["border-base"]).toBe(cab.borderStrong)
    expect(tokens["icon-success-base"]).toBe(cab.success)
    expect(tokens["icon-warning-base"]).toBe(cab.warning)
    expect(tokens["icon-critical-base"]).toBe(cab.danger)
  })

  test.each(modes)("%s: слой v2 — поверхности и текст кабинета", (mode) => {
    const cab = CABINET_TOKENS[mode]
    expect(v2(mode, "v2-background-bg-base")).toBe(cab.background)
    expect(v2(mode, "v2-background-bg-layer-01")).toBe(cab.card)
    expect(v2(mode, "v2-background-bg-layer-02")).toBe(cab.muted2)
    expect(v2(mode, "v2-text-text-base")).toBe(cab.foreground)
    expect(v2(mode, "v2-text-text-muted")).toBe(cab.mutedForeground)
    expect(v2(mode, "v2-text-text-faint")).toBe(cab.faint)
  })

  test.each(modes)("%s: бренд, основная кнопка и фокус — как в кабинете", (mode) => {
    const cab = CABINET_TOKENS[mode]
    expect(v2(mode, "v2-background-bg-accent")).toBe(cab.primary)
    expect(v2(mode, "v2-background-bg-contrast")).toBe(cab.primary)
    expect(v2(mode, "v2-background-bg-icon-button-contrast")).toBe(cab.primary)
    expect(v2(mode, "v2-text-text-contrast")).toBe(cab.primaryForeground)
    expect(v2(mode, "v2-text-text-accent")).toBe(cab.primary)
    expect(v2(mode, "v2-border-border-focus")).toBe(cab.ring)
  })

  test.each(modes)("%s: состояния — мягкие цвета кабинета", (mode) => {
    const cab = CABINET_TOKENS[mode]
    expect(v2(mode, "v2-state-fg-success")).toBe(cab.successSoftForeground)
    expect(v2(mode, "v2-state-bg-success")).toBe(cab.successSoft)
    expect(v2(mode, "v2-state-fg-warning")).toBe(cab.warningSoftForeground)
    expect(v2(mode, "v2-state-bg-warning")).toBe(cab.warningSoft)
    expect(v2(mode, "v2-state-fg-danger")).toBe(cab.dangerSoftForeground)
    expect(v2(mode, "v2-state-bg-danger")).toBe(cab.dangerSoft)
    expect(v2(mode, "v2-state-fg-info")).toBe(cab.infoForeground)
    expect(v2(mode, "v2-state-bg-info")).toBe(cab.info)
  })

  // Свои токены Buff для элементов кабинета (app/src/buff/cabinet-ui.css): выделение и наведение.
  test.each(modes)("%s: выделенное — светло-синее, наведение — цвет колонки, как в кабинете", (mode) => {
    const cab = CABINET_TOKENS[mode]
    expect(v2(mode, "v2-buff-selected")).toBe(cab.selected)
    expect(v2(mode, "v2-buff-selected-fg")).toBe(cab.selectedForeground)
    expect(v2(mode, "v2-buff-hover")).toBe(cab.muted)
    expect(v2(mode, "v2-buff-fg-2")).toBe(cab.fg2)
  })

  test.each(modes)("%s: затемнение и наведение — серо-синие, как в кабинете, а не нейтральные", (mode) => {
    const tokens = resolveThemeV2(theme)[mode]
    expect(tokens["v2-overlay-simple-overlay-scrim"]).toBe(mode === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(15, 23, 42, 0.4)")
    expect(tokens["v2-overlay-simple-overlay-hover"]).toBe(mode === "dark" ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.04)")
  })

  test.each(modes)("%s: значки контрастнее от бледного к основному, обратный — под цвет фона", (mode) => {
    const tokens = resolveThemeV2(theme)[mode]
    const bg = hex(deref(tokens, "v2-background-bg-base")) as HexColor
    const ratio = (key: string) => contrastRatio(hex(deref(tokens, key)) as HexColor, bg)
    expect(ratio("v2-icon-icon-faint")).toBeLessThan(ratio("v2-icon-icon-muted"))
    expect(ratio("v2-icon-icon-muted")).toBeLessThan(ratio("v2-icon-icon-base"))
    expect(hex(deref(tokens, "v2-icon-icon-inverse"))).toBe(bg)
  })

  test.each(modes)("%s: текст читается на фоне и на основной кнопке (AA)", (mode) => {
    const cab = CABINET_TOKENS[mode]
    for (const key of ["v2-text-text-base", "v2-text-text-muted", "v2-text-text-accent", "v2-state-fg-danger"])
      expect(contrastRatio(v2(mode, key) as HexColor, cab.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(cab.primaryForeground, cab.primary)).toBeGreaterThanOrEqual(4.5)
  })

  // Тени кабинета — Tailwind shadow-sm / shadow-md / shadow-2xl; тонкий обвод остаётся границей.
  test.each(modes)("%s: тени поверхностей — как в кабинете, с тонким обводом", (mode) => {
    const tokens = resolveThemeV2(theme)[mode]
    expect(tokens["v2-elevation-raised"]).toStartWith("0 1px 3px 0 ")
    expect(tokens["v2-elevation-floating"]).toStartWith("0 4px 6px -1px ")
    expect(tokens["v2-elevation-overlay"]).toStartWith("0 25px 50px -12px ")
    for (const key of ["v2-elevation-raised", "v2-elevation-floating", "v2-elevation-overlay"])
      expect(tokens[key]).toContain("0 0 0 0.5px ")
  })
})
