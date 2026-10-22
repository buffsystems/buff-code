// Чипы поля ввода (#459): большая вставка, цитата из ответа и почему вложение уходит так, как уходит.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffComposerParts } from "../src/buff-composer-parts.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)

describe("a large paste", () => {
  test("from three lines or more than 150 characters — the console's threshold, one rule for both", () => {
    expect(BuffComposerParts.isLargePaste("одна\nдве")).toBe(false)
    expect(BuffComposerParts.isLargePaste("одна\nдве\nтри")).toBe(true)
    expect(BuffComposerParts.isLargePaste("а".repeat(150))).toBe(false)
    expect(BuffComposerParts.isLargePaste("а".repeat(151))).toBe(true)
  })
  test("is said with its size", () => {
    expect(BuffComposerParts.pasteLabel("а\nб\nв", ru, ruN)).toBe("Вставленный текст · 3 строки")
    expect(BuffComposerParts.pasteLabel("x\n".repeat(560) + "x", ru, ruN)).toBe("Вставленный текст · 561 строка")
    expect(BuffComposerParts.pasteLabel("x\n".repeat(4) + "x", ru, ruN)).toBe("Вставленный текст · 5 строк")
  })
})

describe("a quote from an answer", () => {
  test("is labelled and goes to the model as a quote, whole", () => {
    expect(BuffComposerParts.quoteLabel("одна строка", ru, ruN)).toBe("Из ответа · 1 строка")
    expect(BuffComposerParts.pasteLabel("а\nб\nв")).toBe("Pasted text · 3 lines")
    expect(BuffComposerParts.quoteBlock("первая\nвторая")).toBe("> первая\n> вторая")
  })
})

describe("what goes to the model", () => {
  test("pasted text — whole, in its own block; quotes — as quotes", () => {
    expect(
      BuffComposerParts.appendTo("Посмотри", [
        { kind: "paste", text: "строка 1\nстрока 2\nстрока 3" },
        { kind: "quote", text: "так сказала модель" },
      ]),
    ).toBe("Посмотри\n\nстрока 1\nстрока 2\nстрока 3\n\n> так сказала модель")
  })
  test("nothing extra — the text as it was", () => {
    expect(BuffComposerParts.appendTo("Привет", [])).toBe("Привет")
  })
})

describe("why an attachment goes the way it goes", () => {
  test("the model reads it itself — nothing to say", () => {
    expect(BuffComposerParts.attachmentNote({ route: "inline", mime: "image/png", size: 1000 })).toBeUndefined()
  })
  test("the model does not read this type — its tools open the file", () => {
    expect(ru(BuffComposerParts.attachmentNote({ route: "file", mime: "image/png", size: 1000, reason: "type" })!)).toBe(
      "Модель не читает картинки сама — откроет файл инструментами.",
    )
    expect(
      ru(BuffComposerParts.attachmentNote({ route: "file", mime: "application/zip", size: 1000, reason: "type" })!),
    ).toBe("Модель прочитает этот файл инструментами.")
  })
  test("too large to travel inside the request — goes as a file", () => {
    expect(
      ru(BuffComposerParts.attachmentNote({ route: "file", mime: "image/png", size: 25 * 1024 * 1024, reason: "size" })!),
    ).toBe("Больше 20 МБ — уйдёт файлом, модель откроет его инструментами.")
  })
})

test("every attachment note has a Russian translation", () => {
  const notes = [
    BuffComposerParts.attachmentNote({ route: "file", mime: "image/png", size: 1, reason: "type" })!,
    BuffComposerParts.attachmentNote({ route: "file", mime: "application/pdf", size: 1, reason: "type" })!,
    BuffComposerParts.attachmentNote({ route: "file", mime: "text/plain", size: 1, reason: "type" })!,
    BuffComposerParts.attachmentNote({ route: "file", mime: "image/png", size: 1, reason: "size" })!,
  ]
  for (const note of notes) expect(ru(note)).not.toBe(note)
})
