// Текст ответа в подсказках и отрывках (#470): без разметки Markdown — «**Чайная лавка**» читается как «Чайная лавка».
import { expect, test } from "bun:test"
import { BuffPlainText } from "../src/buff-plain-text.js"
import { BuffSearch } from "../src/buff-search.js"
import { BuffQueryMap } from "../src/buff-query-map.js"

test("выделение, код, заголовки, списки, цитаты и ссылки — простым текстом", () => {
  expect(BuffPlainText.of("**Чайная лавка** — магазин")).toBe("Чайная лавка — магазин")
  expect(BuffPlainText.of("## Состав\n- `src/cart.js` — корзина\n1. шаг")).toBe("Состав\nsrc/cart.js — корзина\nшаг")
  expect(BuffPlainText.of("> цитата [кабинет](https://buff.systems) ![схема](a.png)")).toBe("цитата кабинет схема")
  expect(BuffPlainText.of("```js\nconst a = 1\n```")).toBe("const a = 1")
})

test("таблица — словами, без черт и строки-разделителя", () => {
  expect(BuffPlainText.of("| Вид | Цена |\n|---|---:|\n| пуэр | 980 |")).toBe("Вид Цена\nпуэр 980")
})

test("имена с подчёркиванием и одиночные звёздочки в формулах не ломаются", () => {
  expect(BuffPlainText.of("snake_case_name и 2 * 3 * 4")).toBe("snake_case_name и 2 * 3 * 4")
  expect(BuffPlainText.of("ls | grep cart")).toBe("ls | grep cart")
})

test("отрывок поиска и подсказка карты — без разметки", () => {
  expect(BuffSearch.fragment("Два чая: **Те Гуань Инь** — 760 ₽", "гуань", 40)).toEqual({
    before: "Два чая: Те ",
    match: "Гуань",
    after: " Инь — 760 ₽",
  })
  const preview = BuffQueryMap.preview({
    index: 1,
    text: "Что это?",
    answer: "**Чайная лавка** — магазин",
    running: false,
  } as never)
  expect(preview.answer).toBe("Чайная лавка — магазин")
})
