// Что написать на месте пустого списка (#458): загрузка, сбой и «ничего нет» — разные вещи.
import { expect, test } from "bun:test"
import { listNotice } from "./list-notice"

test("a list still loading says so", () => {
  expect(listNotice({ pending: true, failed: false, empty: true })).toBe("loading")
})

test("a list that failed to load is not an empty list", () => {
  expect(listNotice({ pending: false, failed: true, empty: true })).toBe("failed")
  // …даже когда что-то показать всё же есть: это остаток, а не весь список.
  expect(listNotice({ pending: false, failed: true, empty: false })).toBe("failed")
})

test("a list that loaded with nothing in it is empty", () => {
  expect(listNotice({ pending: false, failed: false, empty: true })).toBe("empty")
})

test("a list with items needs no notice", () => {
  expect(listNotice({ pending: false, failed: false, empty: false })).toBeUndefined()
})
