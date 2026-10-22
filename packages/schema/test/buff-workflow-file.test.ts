// Сценарии (#448): файл — валидный TypeScript: блок метаданных, затем скрипт как есть.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffWorkflowFile } from "../src/buff-workflow-file.js"

// Слова схемы — английские; русские ожидания — через переводчик по каталогу (#472).
const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruAll = (problems: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(problems).map(([name, text]) => [name, ru(text)]))
const ruOf = (parsed: { readonly problem?: string } | object) =>
  "problem" in parsed && parsed.problem ? ru(parsed.problem) : parsed

const meta: BuffWorkflowFile.Meta = {
  name: "review-diff",
  description: "Проверить изменения ветки и собрать замечания",
  whenToUse: "Перед отправкой ветки на ревью",
  args: {
    base: { type: "string", description: "С какой веткой сравнивать", default: "main" },
    depth: { type: "number", required: true },
    strict: { type: "boolean", default: false },
    extra: { type: "json" },
  },
}
const script = 'phase("Collect")\nconst x = await agent("a").ask("hi")\n'

describe("the workflow file", () => {
  test("round-trips: metadata block, then the script verbatim", () => {
    const text = BuffWorkflowFile.serialize(meta, script)
    expect(text.startsWith("/* buff-workflow\n")).toBe(true)
    expect(text.endsWith(script)).toBe(true)
    expect(BuffWorkflowFile.parse(text)).toEqual({ meta, script })
  })
  test("a file without the block, or with a broken one, says why", () => {
    expect(ruOf(BuffWorkflowFile.parse("const x = 1"))).toEqual(
      "Нет блока метаданных /* buff-workflow … */ в начале файла.",
    )
    expect(ruOf(BuffWorkflowFile.parse("/* buff-workflow\n{ nope\n*/\nx"))).toEqual(
      "Метаданные в начале файла не читаются как JSON.",
    )
    expect(ruOf(BuffWorkflowFile.parse('/* buff-workflow\n{"name":"x"}\n*/\n'))).toEqual("Нет описания сценария.")
  })
  test("names are file-safe", () => {
    expect(BuffWorkflowFile.nameProblem("review-diff.v2_1")).toBeUndefined()
    expect(ru(BuffWorkflowFile.nameProblem("")!)).toBe("Имя — латинские буквы, цифры, точка, дефис и подчёркивание.")
    expect(ru(BuffWorkflowFile.nameProblem("../x")!)).toBe(
      "Имя — латинские буквы, цифры, точка, дефис и подчёркивание.",
    )
  })
})

// #470: имя — для файла, латиницей; человек видит название на своём языке.
describe("the name a person sees", () => {
  test("the title when given, otherwise the file name", () => {
    expect(BuffWorkflowFile.displayName({ ...meta, title: "Ревью ветки" })).toBe("Ревью ветки")
    expect(BuffWorkflowFile.displayName({ ...meta, title: "  " })).toBe("review-diff")
    expect(BuffWorkflowFile.displayName(meta)).toBe("review-diff")
  })
  test("the title survives the file round-trip", () => {
    const titled = { ...meta, title: "Ревью ветки" }
    expect(BuffWorkflowFile.parse(BuffWorkflowFile.serialize(titled, script))).toEqual({ meta: titled, script })
  })
})

describe("arguments", () => {
  test("defaults are filled in; a complete, checked bag comes out", () => {
    expect(BuffWorkflowFile.checkArgs(meta.args, { depth: 3 })).toEqual({
      values: { base: "main", depth: 3, strict: false },
    })
  })
  test("each wrong value says what is wrong", () => {
    const wrong = BuffWorkflowFile.checkArgs(meta.args, { depth: "три", strict: "да", unknown: 1 })
    expect("problems" in wrong && ruAll(wrong.problems)).toEqual({
      depth: "Должно быть число.",
      strict: "Должно быть да или нет.",
      unknown: "Сценарий не знает такого аргумента.",
    })
    expect(BuffWorkflowFile.checkArgs(meta.args, {})).toEqual({ problems: { depth: "Required argument." } })
  })
  test("typed fields: text from a form becomes the value", () => {
    expect(BuffWorkflowFile.fromText({ type: "number" }, "42")).toEqual({ value: 42 })
    expect(ruOf(BuffWorkflowFile.fromText({ type: "number" }, "4x"))).toBe("Должно быть число.")
    expect(BuffWorkflowFile.fromText({ type: "json" }, '{"a":1}')).toEqual({ value: { a: 1 } })
    expect(ruOf(BuffWorkflowFile.fromText({ type: "json" }, "{a"))).toBe("Не читается как JSON.")
    expect(BuffWorkflowFile.fromText({ type: "string" }, "")).toEqual({})
    expect(BuffWorkflowFile.fromText({ type: "boolean" }, "true")).toEqual({ value: true })
  })
  test("declarations are checked when saving", () => {
    expect(BuffWorkflowFile.declarationProblems({ "": { type: "string" } }, ru)).toEqual(["У аргумента нет имени."])
    expect(BuffWorkflowFile.declarationProblems({ n: { type: "number", default: "x" } }, ru)).toEqual([
      "n: значение по умолчанию не того типа.",
    ])
    expect(BuffWorkflowFile.declarationProblems(meta.args)).toEqual([])
  })
})
