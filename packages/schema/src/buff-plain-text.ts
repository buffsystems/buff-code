export * as BuffPlainText from "./buff-plain-text.js"

/**
 * Ответ модели простым текстом (#470): в подсказках карты запросов и в отрывках поиска разметка
 * Markdown видна как есть («**Чайная лавка**», «- »). Снимается только то, что точно разметка:
 * подчёркивания в именах и звёздочки в формулах остаются.
 */
export function of(markdown: string): string {
  return markdown
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?::?-{3,}:?)?\s*$\n?/gm, "")
    .replace(/^\s*\|.*$/gm, (row) =>
      row
        .replace(/^\s*\||\|\s*$/g, "")
        .trim()
        .replace(/\s*\|\s*/g, " "),
    )
    .trim()
}
