/**
 * Веса шрифта (#471). Шкала апстрима подобрана под Inter (440 — обычный, 530 — средний); окно
 * Buff — на Geist, как приложение личного кабинета, со шкалой 400 / 500 / 600. При сборке веса
 * апстрима в готовом CSS приводятся к шкале кабинета; свои веса кабинета не трогаются.
 */

const CABINET = { 440: 400, 530: 500, 540: 500, 640: 600 }
const WEIGHT = /(font-weight\s*:\s*)(\d+)(?=\s*(?:;|$|}|!))/g

/** Веса апстрима в CSS — к шкале кабинета. */
export function cabinetFontWeights(css) {
  return css.replace(WEIGHT, (match, prop, value) => (value in CABINET ? `${prop}${CABINET[value]}` : match))
}

/** Плагин сборки: переписывает готовые CSS-файлы — к этому моменту в них и стили компонентов, и классы Tailwind. */
export function buffFontWeight() {
  return {
    name: "buff:font-weight",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue
        file.source = cabinetFontWeights(String(file.source))
      }
    },
  }
}
