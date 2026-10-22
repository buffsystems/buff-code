// Buff (#471): единственная тема окна — на токенах приложения личного кабинета (frontend/src/styles/global.css).
// Строится поверх oc-2 данными: та же структура токенов, свои значения; стили апстрима не правятся.
import type { DesktopTheme, HexColor, ThemePaletteColors, ThemeVariant, V2ColorValue } from "./types"

/** Токены кабинета, светлая и тёмная темы; faint — бледный текст подсказок (slate-400 / его тёмная пара). */
export const CABINET_TOKENS = {
  light: {
    background: "#ffffff",
    foreground: "#0f172a",
    fg2: "#3f4350",
    card: "#ffffff",
    muted: "#f1f5f9",
    muted2: "#eceef2",
    mutedForeground: "#64748b",
    faint: "#94a3b8",
    border: "#e8e9ee",
    borderStrong: "#d0d3dc",
    primary: "#2563eb",
    primaryForeground: "#f8fafc",
    primaryHover: "#1d4ed8",
    ring: "#2563eb",
    selected: "#dbeafe",
    selectedForeground: "#1d4ed8",
    success: "#0b7f55",
    successSoft: "#e3f7ee",
    successSoftForeground: "#0b6b49",
    warning: "#a15f00",
    warningSoft: "#fff3dc",
    warningSoftForeground: "#8a4b00",
    danger: "#d3273e",
    dangerSoft: "#ffe6ea",
    dangerSoftForeground: "#9b1c2e",
    info: "#e8efff",
    infoForeground: "#1e40af",
  },
  dark: {
    background: "#0b0d12",
    foreground: "#edeef2",
    fg2: "#c3c7d1",
    card: "#10131a",
    muted: "#12151c",
    muted2: "#1a1e27",
    mutedForeground: "#9aa0ad",
    faint: "#6b7282",
    border: "#222633",
    borderStrong: "#323747",
    primary: "#5b8bff",
    primaryForeground: "#06070a",
    primaryHover: "#7aa1ff",
    ring: "#7aa1ff",
    selected: "#16223f",
    selectedForeground: "#a9c1ff",
    success: "#34d399",
    successSoft: "#0f2a20",
    successSoftForeground: "#7fe3bb",
    warning: "#fbbf24",
    warningSoft: "#2e2208",
    warningSoftForeground: "#fcd67a",
    danger: "#f87171",
    dangerSoft: "#3a1519",
    dangerSoftForeground: "#ffb3b3",
    info: "#16223f",
    infoForeground: "#a9c1ff",
  },
} as const satisfies Record<"light" | "dark", Record<string, HexColor>>

type Cabinet = (typeof CABINET_TOKENS)[keyof typeof CABINET_TOKENS]

/** Рамка окна (заголовок, колонка сессий) — цвет колонки навигации кабинета; до загрузки темы её же
 *  рисует `app/public/oc-theme-preload.js`. */
export const BUFF_FRAME = { light: CABINET_TOKENS.light.muted, dark: CABINET_TOKENS.dark.muted } as const

const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

const ramp = (name: string, colors: readonly HexColor[]): Record<string, HexColor> =>
  Object.fromEntries(STEPS.map((step, i) => [`v2-${name}-${step}`, colors[i]!]))

/** Серый кабинета (slate): ступени попадают в его фон, колонку, границы и текст. */
const GREY = {
  "v2-grey-50": "#ffffff",
  ...ramp("grey", [
    "#f8fafc",
    "#f1f5f9",
    "#e8e9ee",
    "#d0d3dc",
    "#94a3b8",
    "#8790a0",
    "#64748b",
    "#3f4350",
    "#323747",
    "#222633",
    "#12151c",
    "#0b0d12",
  ]),
}

/** Семейства цветов — Tailwind blue / emerald / amber / red (50…950 → 100…1100), как в кабинете. */
const HUES = {
  ...ramp("blue", [
    "#eff6ff",
    "#dbeafe",
    "#bfdbfe",
    "#93c5fd",
    "#60a5fa",
    "#3b82f6",
    "#2563eb",
    "#1d4ed8",
    "#1e40af",
    "#1e3a8a",
    "#172554",
    "#0b1530",
  ]),
  ...ramp("green", [
    "#ecfdf5",
    "#d1fae5",
    "#a7f3d0",
    "#6ee7b7",
    "#34d399",
    "#10b981",
    "#059669",
    "#047857",
    "#065f46",
    "#064e3b",
    "#022c22",
    "#01201a",
  ]),
  ...ramp("yellow", [
    "#fffbeb",
    "#fef3c7",
    "#fde68a",
    "#fcd34d",
    "#fbbf24",
    "#f59e0b",
    "#d97706",
    "#b45309",
    "#92400e",
    "#78350f",
    "#451a03",
    "#2a1503",
  ]),
  ...ramp("red", [
    "#fef2f2",
    "#fee2e2",
    "#fecaca",
    "#fca5a5",
    "#f87171",
    "#ef4444",
    "#dc2626",
    "#b91c1c",
    "#991b1b",
    "#7f1d1d",
    "#450a0a",
    "#2a0a0a",
  ]),
}

const palette = (cab: Cabinet, base: ThemeVariant, dark: boolean): ThemePaletteColors => ({
  ...("palette" in base && base.palette ? base.palette : {}),
  neutral: cab.muted,
  ink: cab.foreground,
  primary: cab.primary,
  interactive: cab.primary,
  success: cab.success,
  warning: cab.warning,
  error: cab.danger,
  info: dark ? "#edb2f1" : "#a753ae",
  diffAdd: dark ? "#7fe3bb" : "#86efac",
  diffDelete: cab.danger,
})

/** Слой v1: фон, текст, границы и поверхности — прямо из токенов кабинета. */
const overrides = (cab: Cabinet): Record<string, HexColor> => ({
  "background-base": cab.background,
  "background-stronger": cab.card,
  "text-strong": cab.foreground,
  "text-base": cab.mutedForeground,
  "text-weak": cab.faint,
  "text-weaker": cab.faint,
  "text-interactive-base": cab.primary,
  "border-base": cab.borderStrong,
  "border-weak-base": cab.border,
  "border-weaker-base": cab.border,
  "icon-base": cab.mutedForeground,
  "icon-weak-base": cab.faint,
  "surface-base": cab.muted,
  "surface-raised-base": cab.muted,
  "surface-raised-base-hover": cab.muted2,
  "surface-raised-stronger-non-alpha": cab.card,
  "surface-interactive-weak": cab.selected,
  "icon-success-base": cab.success,
  "icon-warning-base": cab.warning,
  "icon-critical-base": cab.danger,
  "surface-success-base": cab.successSoft,
  "surface-critical-base": cab.dangerSoft,
})

/** Слой v2: смысловые токены кабинета — поверхности, текст, бренд, выделение, состояния. */
const semantics = (cab: Cabinet): Record<string, V2ColorValue> => ({
  "v2-background-bg-base": cab.background,
  "v2-background-bg-deep": cab.muted,
  "v2-background-bg-layer-01": cab.card,
  "v2-background-bg-layer-02": cab.muted2,
  "v2-background-bg-layer-03": cab.border,
  "v2-background-bg-layer-04": cab.borderStrong,
  "v2-background-bg-button-neutral": cab.card,
  "v2-background-bg-accent": cab.primary,
  // Основная кнопка и отправка — как в кабинете: бренд с его цветом текста.
  "v2-background-bg-contrast": cab.primary,
  "v2-background-bg-icon-button-contrast": cab.primary,
  "v2-text-text-contrast": cab.primaryForeground,
  "v2-text-text-base": cab.foreground,
  "v2-text-text-muted": cab.mutedForeground,
  "v2-text-text-faint": cab.faint,
  "v2-text-text-accent": cab.primary,
  "v2-text-text-accent-hover": cab.primaryHover,
  "v2-icon-icon-base": cab.fg2,
  "v2-icon-icon-muted": cab.mutedForeground,
  "v2-icon-icon-faint": cab.faint,
  "v2-icon-icon-accent": cab.primary,
  "v2-icon-icon-accent-hover": cab.primaryHover,
  "v2-icon-icon-inverse": cab.background,
  "v2-border-border-muted": cab.border,
  "v2-border-border-base": cab.border,
  "v2-border-border-strong": cab.borderStrong,
  "v2-border-border-focus": cab.ring,
  "v2-state-bg-success": cab.successSoft,
  "v2-state-fg-success": cab.successSoftForeground,
  "v2-state-bg-warning": cab.warningSoft,
  "v2-state-fg-warning": cab.warningSoftForeground,
  "v2-state-bg-danger": cab.dangerSoft,
  "v2-state-fg-danger": cab.dangerSoftForeground,
  "v2-state-bg-info": cab.info,
  "v2-state-fg-info": cab.infoForeground,
  // Свои токены Buff для элементов кабинета (app/src/buff/cabinet-ui.css).
  "v2-buff-selected": cab.selected,
  "v2-buff-selected-fg": cab.selectedForeground,
  "v2-buff-hover": cab.muted,
  "v2-buff-fg-2": cab.fg2,
})

/** Тени кабинета (Tailwind shadow-sm / -md / -2xl) поверх тонкого обвода, который в окне служит границей. */
const elevation = (dark: boolean): Record<string, V2ColorValue> => {
  const shade = (light: number, deep: number) => `var(--v2-alpha-dark-${dark ? deep : light})`
  const ring = dark ? "0 0 0 0.5px var(--v2-alpha-light-16)" : "0 0 0 0.5px var(--v2-alpha-dark-12)"
  return {
    "v2-elevation-raised": `0 1px 3px 0 ${shade(10, 30)}, 0 1px 2px -1px ${shade(10, 30)}, ${ring}`,
    "v2-elevation-floating": `0 4px 6px -1px ${shade(10, 40)}, 0 2px 4px -2px ${shade(10, 40)}, ${ring}`,
    "v2-elevation-overlay": `0 25px 50px -12px ${shade(24, 60)}, ${ring}`,
  }
}

/** Затемнение под диалогом и наведение — серо-синие, как в кабинете, а не нейтральные апстрима. */
const overlays = (dark: boolean): Record<string, V2ColorValue> =>
  dark
    ? {
        "v2-overlay-simple-overlay-scrim": "rgba(0, 0, 0, 0.6)",
        "v2-overlay-simple-overlay-hover": "rgba(255, 255, 255, 0.05)",
        "v2-overlay-simple-overlay-pressed": "rgba(255, 255, 255, 0.09)",
      }
    : {
        "v2-overlay-simple-overlay-scrim": "rgba(15, 23, 42, 0.4)",
        "v2-overlay-simple-overlay-hover": "rgba(15, 23, 42, 0.04)",
        "v2-overlay-simple-overlay-pressed": "rgba(15, 23, 42, 0.08)",
      }

const variant = (base: ThemeVariant, cab: Cabinet, dark: boolean): ThemeVariant => ({
  palette: palette(cab, base, dark),
  overrides: { ...base.overrides, ...overrides(cab) },
  v2Overrides: { ...base.v2Overrides, ...GREY, ...HUES, ...semantics(cab), ...elevation(dark), ...overlays(dark) },
})

/** Тема Buff поверх oc-2: тот же id, чтобы весь апстрим, заточенный на тему по умолчанию, работал как есть. */
export function buffTheme(base: DesktopTheme): DesktopTheme {
  return {
    ...base,
    name: "Buff",
    light: variant(base.light, CABINET_TOKENS.light, false),
    dark: variant(base.dark, CABINET_TOKENS.dark, true),
  }
}
