// Сессия без названия (#470): окно и консоль показывали «New session» / «New session - <время>».
import { expect, test } from "bun:test"
import { buffSessionLabel } from "../src/buff-session-label.js"

const ru = (text: string) => ({ "New chat": "Новый чат", "Child chat": "Чат субагента" })[text] ?? text

test("служебное имя — переведённая подпись без метки времени", () => {
  expect(buffSessionLabel({ title: "New session - 2026-10-04T06:49:50.199Z" }, ru)).toBe("Новый чат")
  expect(buffSessionLabel({ title: "Child session - 2026-10-04T06:49:50.199Z" }, ru)).toBe("Чат субагента")
  expect(buffSessionLabel({}, ru)).toBe("Новый чат")
  expect(buffSessionLabel({ parentID: "ses_1" }, ru)).toBe("Чат субагента")
})

test("настоящее название не переводится", () => {
  expect(buffSessionLabel({ title: "New chat" }, ru)).toBe("New chat")
  expect(buffSessionLabel({ title: "Цены в каталоге" }, ru)).toBe("Цены в каталоге")
})
