/**
 * Размер шрифта интерфейса и кода (#461). Размеры текста в стилях окна заданы пикселями — у
 * апстрима их сотни. При сборке каждый размер становится «размер × множитель интерфейса», а в
 * блоках с моноширинным шрифтом — «размер кода»; множитель и размер задаёт человек в
 * настройках (`src/buff/text-size.ts`). Без настройки вид прежний: множитель 1.
 */

const SIZE = /(font-size|--font-size-[a-z-]+|--text-[a-z0-9-]+)(\s*):(\s*)([0-9.]+(?:px|rem))(?=\s*(?:;|$|}))/g
const MONO = /font-family\s*:[^;}]*(mono|monospace)/i

/** Переписать размеры в одном блоке объявлений. */
function block(body) {
  const mono = MONO.test(body)
  return body.replace(SIZE, (_, prop, before, after, value) => {
    if (mono && prop === "font-size") return `${prop}${before}:${after}var(--buff-code-font-size, ${value})`
    return `${prop}${before}:${after}calc(${value} * var(--buff-ui-scale, 1))`
  })
}

/** Все размеры текста в CSS — через множитель интерфейса или размер кода. */
export function scaleFontSizes(css) {
  return css.replace(/\{([^{}]*)\}/g, (_, body) => `{${block(body)}}`)
}

/**
 * Плагин сборки: переписывает готовые CSS-файлы сборки — к этому моменту в них уже и стили
 * компонентов, и сгенерированные классы Tailwind.
 */
export function buffTextScale() {
  return {
    name: "buff:text-scale",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue
        file.source = scaleFontSizes(String(file.source))
      }
    },
  }
}
