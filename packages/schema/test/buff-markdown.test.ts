// Файл Markdown с шапкой (#445, #446): навыки, команды и субагенты хранятся одинаково.
import { describe, expect, test } from "bun:test"
import { BuffMarkdown } from "../src/buff-markdown.js"

describe("reading", () => {
  test("named values of the header and the text below it", () => {
    const text = "---\ndescription: >\n  Когда просят\n  заметки\nagent: 'build'\nsubagent: true\n---\n\nТекст\n"
    expect(BuffMarkdown.parts(text, ["description", "agent", "subagent", "model"])).toEqual({
      values: { description: "Когда просят заметки", agent: "build", subagent: "true", model: undefined },
      body: "Текст\n",
    })
  })

  test("a file without a header is all text", () => {
    expect(BuffMarkdown.parts("Просто текст\n", ["description"])).toEqual({
      values: { description: undefined },
      body: "Просто текст\n",
    })
  })
})

describe("writing", () => {
  test("a new file: values in the given order, empty ones left out, flags unquoted", () => {
    expect(
      BuffMarkdown.edited(
        "",
        [
          ["description", 'Выкладка "на стенд"'],
          ["agent", ""],
          ["model", undefined],
          ["subagent", "true"],
        ],
        "Выложи $ARGUMENTS",
      ),
    ).toBe('---\ndescription: "Выкладка \\"на стенд\\""\nsubagent: true\n---\n\nВыложи $ARGUMENTS\n')
  })

  test("editing replaces the managed values and keeps what else the header holds", () => {
    const text =
      "---\ndescription: старое\nagent: plan\npermissions:\n  - action: edit\n    effect: deny\n---\nстарый текст\n"
    expect(
      BuffMarkdown.edited(
        text,
        [
          ["description", "новое"],
          ["agent", undefined],
        ],
        "новый текст\n",
      ),
    ).toBe('---\ndescription: "новое"\npermissions:\n  - action: edit\n    effect: deny\n---\n\nновый текст\n')
  })

  test("nothing to say in the header — no header", () => {
    expect(BuffMarkdown.edited("", [["description", ""]], "Текст")).toBe("Текст\n")
  })
})
