// Сессия без названия (#470): пока модель не придумала название, консоль показывала
// «New session - 2026-10-04T06:49:50.199Z» во вкладке и в правой панели — по-английски и с меткой времени.
import { expect, test } from "bun:test"
import { sessionLabel } from "../../src/feature-plugins/buff/session-label"

test("чат без названия — «Новый чат», вложенная — «Чат субагента», без метки времени", () => {
  expect(sessionLabel("New session - 2026-10-04T06:49:50.199Z")).toBe("Новый чат")
  expect(sessionLabel("Child session - 2026-10-04T06:49:50.199Z")).toBe("Чат субагента")
  expect(sessionLabel("New chat")).toBe("Новый чат")
})

test("настоящее название — как есть; нет названия — нет подписи", () => {
  expect(sessionLabel("Цены в каталоге")).toBe("Цены в каталоге")
  expect(sessionLabel(undefined)).toBeUndefined()
})
