// Сессия без названия (#470): окно и консоль показывали «New session» / «New session - <время>».
import { expect, test } from "bun:test"
import { buffSessionLabel } from "../src/buff-session-label.js"

const ru = (text: string) => ({ "New session": "Новая сессия", "Child session": "Сессия субагента" })[text] ?? text

test("служебное имя — переведённая подпись без метки времени", () => {
  expect(buffSessionLabel({ title: "New session - 2026-10-04T06:49:50.199Z" }, ru)).toBe("Новая сессия")
  expect(buffSessionLabel({ title: "Child session - 2026-10-04T06:49:50.199Z" }, ru)).toBe("Сессия субагента")
  expect(buffSessionLabel({}, ru)).toBe("Новая сессия")
  expect(buffSessionLabel({ parentID: "ses_1" }, ru)).toBe("Сессия субагента")
})

test("настоящее название не переводится", () => {
  expect(buffSessionLabel({ title: "New session" }, ru)).toBe("New session")
  expect(buffSessionLabel({ title: "Цены в каталоге" }, ru)).toBe("Цены в каталоге")
})
