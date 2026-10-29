import { describe, expect, test } from "bun:test"
import { BuffDraw } from "../../src/buff/draw"
import { BuffLocale } from "../../src/buff/locale"

describe("draw_image (#27)", () => {
  test("a picture lands in the session's folder, named as asked, extension by its bytes", () => {
    expect(BuffDraw.pictureFile("/w", "кот", "image/png")).toBe("/w/кот.png")
    expect(BuffDraw.pictureFile("/w", "logo.jpg", "image/webp")).toBe("/w/logo.webp")
    expect(BuffDraw.pictureFile("/w", "../../x", "image/jpeg")).toBe("/w/x.jpg")
    expect(BuffDraw.pictureFile("/w", "..", "image/png")).toBeNull()
  })

  test("the connector's answer is a picture, or the refusal in its own words", () => {
    expect(BuffDraw.drawn({ ok: true, mime: "image/jpeg", content: "AAAA" })).toEqual({ mime: "image/jpeg", content: "AAAA" })
    expect(BuffDraw.drawn({ error: { message: "на счёте нет средств" } })).toEqual({ error: "на счёте нет средств" })
    expect(BuffDraw.drawn({ ok: false, error: "нет такого адреса" })).toEqual({ error: "нет такого адреса" })
    expect(BuffDraw.drawn(null)).toEqual({ error: BuffLocale.t("The picture was not drawn.") })
  })
})
