// Buff (#470): форма, которую просит MCP-сервер (запись в базу знаний — «Добавить эту запись?»),
// приходит в окно, но окно её не показывало — вызов висел. Здесь: какую форму показать, с чего
// начинаются поля и какой ответ уходит серверу.
import { expect, test } from "bun:test"
import type { FormInfo } from "@opencode/client/promise"
import { fieldView, formAnswer, formDefaults, formProblem, mcpForm } from "./mcp-request"

const knowledge: FormInfo = {
  id: "frm_1",
  sessionID: "global",
  title: "knowledge is requesting input",
  metadata: { kind: "mcp-elicitation", server: "knowledge", message: "Модель предлагает добавить запись." },
  fields: [{ key: "add", title: "Добавить эту запись в базу знаний", required: true, type: "boolean", default: false }],
}

test("показывается форма MCP, а не вопрос агента или выбор поиска", () => {
  const question = { ...knowledge, id: "frm_q", metadata: { kind: "question" } } as FormInfo
  expect(mcpForm([question, knowledge])?.id).toBe("frm_1")
  expect(mcpForm([question])).toBeUndefined()
  expect(mcpForm(undefined)).toBeUndefined()
})

test("поля начинаются со значений по умолчанию", () => {
  expect(formDefaults(knowledge.fields)).toEqual({ add: false })
  expect(
    formDefaults([
      { key: "name", type: "string", default: "x" },
      { key: "count", type: "integer" },
      { key: "tags", type: "multiselect", options: [] },
    ] as FormInfo["fields"]),
  ).toEqual({ name: "x", count: "", tags: [] })
})

test("ответ — значения видимых полей нужного типа; пустое необязательное не уходит", () => {
  const fields = [
    { key: "add", type: "boolean" },
    { key: "count", type: "integer" },
    { key: "note", type: "string" },
    { key: "secret", type: "string", hidden: true },
  ] as FormInfo["fields"]
  expect(formAnswer(fields, { add: true, count: "3", note: "", secret: "s" })).toEqual({ add: true, count: 3 })
})

test("обязательное пустое поле названо словами", () => {
  const fields = [{ key: "note", title: "Комментарий", type: "string", required: true }] as FormInfo["fields"]
  expect(formProblem(fields, { note: " " }, (text, params) => text.replace("{field}", String(params?.field)))).toBe(
    "Fill in «Комментарий».",
  )
  expect(formProblem(fields, { note: "ok" }, (text) => text)).toBeUndefined()
  expect(formProblem(knowledge.fields, { add: false }, (text) => text)).toBeUndefined()
})

test("вид поля: флажок, выбор одного, несколько, текст, ссылка; один флажок — вопрос «да или нет»", () => {
  const choice = { key: "env", type: "string", options: [{ value: "dev", label: "dev" }] }
  const fields = [
    { key: "add", type: "boolean" },
    choice,
    { key: "tags", type: "multiselect", options: [] },
    { key: "note", type: "string" },
    { key: "count", type: "number" },
    { key: "auth", type: "external", url: "https://example.test" },
  ] as FormInfo["fields"]
  expect(fields.map((field) => fieldView(field, fields))).toEqual(["switch", "choice", "multi", "text", "text", "link"])
  expect(fieldView(knowledge.fields[0]!, knowledge.fields)).toBe("yes-no")
})

test("ссылка подтверждается только после того, как её открыли", () => {
  const fields = [{ key: "auth", type: "external", url: "https://example.test" }] as FormInfo["fields"]
  expect(formAnswer(fields, { auth: true })).toEqual({ auth: true })
  expect(formProblem(fields, {}, (text) => text)).toBe("Open the page first.")
})
