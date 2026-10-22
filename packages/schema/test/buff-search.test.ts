// Поиск по тексту переписки (#453): что ищем, где нашли и какой фрагмент показать.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffSearch } from "../src/buff-search.js"

// #472: строки схемы — английские исходные; ожидания — по-русски, через общий каталог.
const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)
const rn: BuffI18n.N = (c, f, p) => BuffI18n.n("ru", c, f, p)

describe("the text of a message", () => {
  test("a person's message is its text; an answer — its text parts, without tool noise", () => {
    expect(BuffSearch.texts({ type: "user", text: "Почини тесты" })).toEqual(["Почини тесты"])
    expect(
      BuffSearch.texts({
        type: "assistant",
        content: [
          { type: "reasoning", text: "думаю" },
          { type: "text", text: "Готово: тесты зелёные" },
          { type: "tool", name: "shell" },
        ],
      }),
    ).toEqual(["Готово: тесты зелёные"])
    expect(BuffSearch.texts({ type: "idle" })).toEqual([])
  })
})

describe("the fragment", () => {
  const text = "Сначала прочитал файл, потом исправил миграцию базы данных и запустил тесты ещё раз."

  test("the match with some text around it, cut on word edges", () => {
    expect(BuffSearch.fragment(text, "миграцию", 16)).toEqual({
      before: "…потом исправил ",
      match: "миграцию",
      after: " базы данных и…",
    })
  })

  test("case does not matter, the fragment keeps the case of the text", () => {
    expect(BuffSearch.fragment("Запустил ТЕСТЫ", "тесты", 20)).toEqual({
      before: "Запустил ",
      match: "ТЕСТЫ",
      after: "",
    })
  })

  test("line breaks do not tear the fragment", () => {
    expect(BuffSearch.fragment("раз\n\nдва   три", "два", 10)).toEqual({ before: "раз ", match: "два", after: " три" })
  })

  test("no match — no fragment", () => {
    expect(BuffSearch.fragment(text, "нет такого", 16)).toBeUndefined()
    expect(BuffSearch.fragment(text, "  ", 16)).toBeUndefined()
  })
})

describe("how the query is looked up in the database", () => {
  test("as typed and in the usual letter cases — the database compares letters exactly", () => {
    expect(BuffSearch.variants("миграцию")).toEqual(["миграцию", "Миграцию", "МИГРАЦИЮ"])
    expect(BuffSearch.variants("  API ")).toEqual(["API", "api", "Api"])
  })

  test("a short query is not searched — it would match everything", () => {
    expect(ru(BuffSearch.problem("а")!)).toBe("Введите хотя бы два символа.")
    expect(BuffSearch.problem("аб")).toBeUndefined()
  })
})

describe("the result", () => {
  test("one line per session: the newest match first, with how many more there are", () => {
    const hits = [
      {
        sessionID: "s1",
        title: "Миграция",
        messageID: "m1",
        role: "user" as const,
        time: 10,
        text: "исправь миграцию",
      },
      {
        sessionID: "s1",
        title: "Миграция",
        messageID: "m2",
        role: "assistant" as const,
        time: 20,
        text: "Миграцию исправил",
      },
      { sessionID: "s2", title: "Другое", messageID: "m3", role: "user" as const, time: 15, text: "про миграцию тоже" },
    ]
    expect(BuffSearch.results(hits, "миграцию").map((item) => [item.sessionID, item.messageID, item.more])).toEqual([
      ["s1", "m2", 1],
      ["s2", "m3", 0],
    ])
  })

  test("how many more matches a session has — in words", () => {
    expect(BuffSearch.moreLabel(0, rn)).toBeUndefined()
    expect(BuffSearch.moreLabel(1, rn)).toBe("ещё 1 совпадение")
    expect(BuffSearch.moreLabel(3, rn)).toBe("ещё 3 совпадения")
    expect(BuffSearch.moreLabel(12, rn)).toBe("ещё 12 совпадений")
  })
})
