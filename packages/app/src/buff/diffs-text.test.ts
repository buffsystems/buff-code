// Подписи просмотра изменений (#470): библиотека диффов пишет их сама по-английски, патч зовёт перевод Buff.
import { expect, test } from "bun:test"
import { installDiffsText } from "./diffs-text"

const text = (english: string, count?: number) =>
  (globalThis as { __buffDiffsText?: (text: string, count?: number) => string }).__buffDiffsText?.(english, count)

test("подписи — на языке окна, число строк — с русским множественным", () => {
  let locale: "ru" | "en" = "ru"
  installDiffsText(() => locale)
  expect(text("{n} unmodified line|{n} unmodified lines", 14)).toBe("14 строк без изменений")
  expect(text("{n} unmodified line|{n} unmodified lines", 1)).toBe("1 строка без изменений")
  expect(text("Expand all")).toBe("Развернуть всё")
  locale = "en"
  expect(text("{n} unmodified line|{n} unmodified lines", 14)).toBe("14 unmodified lines")
  expect(text("No newline at end of file")).toBe("No newline at end of file")
})
