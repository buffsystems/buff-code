// Выгрузка чата (#969): человек забирает переписку файлом — markdown для чтения, JSON для программ.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffExport } from "../src/buff-export.js"

const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)

const chat = {
  info: { title: "Меню: осень/зима?", time: { created: Date.UTC(2026, 10, 24, 9, 0, 0) } },
  messages: [
    { type: "user", text: "Собери меню", files: [{ name: "prices.csv", mime: "text/csv", data: "QQ==" }], time: { created: 1 } },
    {
      type: "assistant",
      model: { id: "kimi-k2", providerID: "own" },
      cost: 0.12,
      content: [
        { type: "reasoning", text: "подумаю про цены" },
        { type: "tool", name: "read", state: { status: "completed", input: { filePath: "a.txt" } } },
        { type: "text", text: "Готово." },
        {
          type: "tool",
          name: "send_file",
          state: { status: "completed", metadata: { sent: { file: "menu.md", name: "menu.md", mime: "text/markdown", bytes: 9 } } },
        },
        { type: "text", text: "Файл рядом." },
      ],
      time: { created: 2, completed: 3 },
    },
    { type: "idle", outcome: "succeeded", time: { created: 3 } },
    { type: "assistant", content: [], error: { type: "provider.transport", message: "litellm: own/kimi is down" }, time: { created: 4 } },
  ],
}

describe("the file's name", () => {
  test("the chat's title without the signs a file system refuses; an untitled chat is «chat»", () => {
    expect(BuffExport.fileName("Меню: осень/зима?", "md")).toBe("Меню осень зима.md")
    expect(BuffExport.fileName("  ", "json")).toBe("chat.json")
  })
})

describe("markdown", () => {
  test("the title, then who said what — in the person's language; attached and sent files by name", () => {
    expect(BuffExport.markdown(chat, ru)).toBe(
      [
        "# Меню: осень/зима?",
        "",
        "## Вы",
        "",
        "Собери меню",
        "",
        "Файл: prices.csv",
        "",
        "## Buff Code",
        "",
        "Готово.",
        "",
        "Файл: menu.md",
        "",
        "Файл рядом.",
        "",
      ].join("\n"),
    )
    expect(BuffExport.markdown({ info: {}, messages: [] }, BuffI18n.english)).toBe("# Chat\n")
  })

  test("neither form names a model, a provider, a cost, the reasoning or an error's raw words", () => {
    for (const text of [BuffExport.markdown(chat, ru), JSON.stringify(BuffExport.json(chat))])
      expect(text).not.toMatch(/kimi|own|litellm|0\.12|подумаю|provider/)
  })
})

describe("json", () => {
  test("the same reading as data: role, time, text and the files' names", () => {
    expect(BuffExport.json(chat)).toEqual({
      title: "Меню: осень/зима?",
      created: Date.UTC(2026, 10, 24, 9, 0, 0),
      messages: [
        { role: "user", time: 1, text: "Собери меню", files: ["prices.csv"] },
        { role: "assistant", time: 2, text: "Готово.\n\nФайл рядом.", files: ["menu.md"] },
      ],
    })
  })
})
