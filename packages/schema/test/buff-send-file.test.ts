// Файл от агента человеку (#708): тип по имени, что показать по типу, запись вызова в ленте.
import { describe, expect, test } from "bun:test"
import { BuffSendFile } from "../src/buff-send-file.js"
import { BuffI18n } from "../src/buff-i18n.js"

describe("mimeOf", () => {
  test("documents, tables, pictures and text by the extension, any case", () => {
    expect(BuffSendFile.mimeOf("Программа.DOCX")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(BuffSendFile.mimeOf("план.pdf")).toBe("application/pdf")
    expect(BuffSendFile.mimeOf("a.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(BuffSendFile.mimeOf("a.png")).toBe("image/png")
    expect(BuffSendFile.mimeOf("README.md")).toBe("text/markdown")
    expect(BuffSendFile.mimeOf("data.csv")).toBe("text/csv")
    expect(BuffSendFile.mimeOf("noext")).toBe("application/octet-stream")
  })
})

describe("kindOf", () => {
  test("a picture and text show in place, the rest opens in the system", () => {
    expect(BuffSendFile.kindOf("image/webp")).toBe("image")
    expect(BuffSendFile.kindOf("text/markdown")).toBe("text")
    expect(BuffSendFile.kindOf("application/json")).toBe("text")
    expect(BuffSendFile.kindOf("application/pdf")).toBe("document")
    expect(BuffSendFile.kindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "document",
    )
  })
})

describe("sentOf", () => {
  test("the file a call handed over, from its metadata", () => {
    const sent = { file: "docs/plan.docx", name: "plan.docx", mime: "application/pdf", bytes: 10, note: "Черновик" }
    expect(BuffSendFile.sentOf({ sent })).toEqual(sent)
    expect(BuffSendFile.sentOf({ sent: { ...sent, note: undefined } })).toEqual({ ...sent, note: undefined })
    expect(BuffSendFile.sentOf({})).toBeUndefined()
    expect(BuffSendFile.sentOf({ sent: { file: "x" } })).toBeUndefined()
    expect(BuffSendFile.sentOf(undefined)).toBeUndefined()
  })
})

describe("sizeOf", () => {
  test("kilobytes and megabytes, in the person's language", () => {
    const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
    expect(BuffSendFile.sizeOf(100)).toBe("1 KB")
    expect(BuffSendFile.sizeOf(12 * 1024, ru)).toBe("12 КБ")
    expect(BuffSendFile.sizeOf(1.5 * 1024 * 1024, ru)).toBe("1.5 МБ")
  })
})
