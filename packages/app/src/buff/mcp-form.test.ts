// Форма MCP-сервера в настройках (#444): поля ↔ запись в файле конфигурации.
import { expect, test } from "bun:test"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { emptyForm, formFromConfig, formToServers } from "./mcp-form"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

test("a local server: the command line splits into program and arguments, variables into a record", () => {
  const form = {
    ...emptyForm("user"),
    name: "files",
    command: 'npx -y "@acme/files server"',
    environment: "ROOT=/srv\nTOKEN={env:T}",
  }
  expect(formToServers(form)).toEqual({
    servers: [
      {
        name: "files",
        config: {
          type: "local",
          command: ["npx", "-y", "@acme/files server"],
          environment: { ROOT: "/srv", TOKEN: "{env:T}" },
        },
      },
    ],
  })
})

test("a remote server: the address and its headers", () => {
  const form = {
    ...emptyForm("project"),
    name: "web",
    kind: "remote" as const,
    url: " https://mcp.example.com ",
    headers: "Authorization=Bearer x",
  }
  expect(formToServers(form)).toEqual({
    servers: [
      {
        name: "web",
        config: { type: "remote", url: "https://mcp.example.com", headers: { Authorization: "Bearer x" } },
      },
    ],
  })
})

test("empty variables and headers are left out of the record", () => {
  expect(formToServers({ ...emptyForm("user"), name: "files", command: "srv" })).toEqual({
    servers: [{ name: "files", config: { type: "local", command: ["srv"] } }],
  })
})

test("what the form cannot save, it says — the name first", () => {
  expect(formToServers({ ...emptyForm("user"), name: "my server", command: "srv" }, undefined, ru)).toEqual({
    problem: "Имя — латинские буквы, цифры, дефис и подчёркивание, без пробелов.",
  })
  expect(formToServers({ ...emptyForm("user"), name: "files" }, undefined, ru)).toEqual({
    problem: "Укажите команду запуска сервера.",
  })
  expect(
    formToServers({ ...emptyForm("user"), name: "files", command: "srv", environment: "nope" }, undefined, ru),
  ).toEqual({
    problem: "Строка «nope» — не в виде ИМЯ=значение.",
  })
})

test("editing keeps what the form does not show — timeouts, sign-in settings, the off switch", () => {
  const stored = {
    type: "remote" as const,
    url: "https://old.example",
    headers: { A: "1" },
    oauth: { client_id: "abc" },
    timeout: { startup: 5000 },
    disabled: true,
  }
  const form = { ...formFromConfig("web", "user", stored), url: "https://new.example" }
  expect(form.headers).toBe("A=1")
  expect(formToServers(form, stored)).toEqual({
    servers: [{ name: "web", config: { ...stored, url: "https://new.example" } }],
  })
})

test("the JSON tab saves what was pasted: one server under the form's name, or a whole block under its own names", () => {
  const one = {
    ...emptyForm("user"),
    name: "files",
    mode: "json" as const,
    json: '{ "command": "srv", "args": ["--x"] }',
  }
  expect(formToServers(one)).toEqual({
    servers: [{ name: "files", config: { type: "local", command: ["srv", "--x"] } }],
  })
  const block = {
    ...emptyForm("user"),
    mode: "json" as const,
    json: '{ "mcpServers": { "a": { "command": "x" }, "b": { "url": "https://b.example" } } }',
  }
  expect(formToServers(block)).toEqual({
    servers: [
      { name: "a", config: { type: "local", command: ["x"] } },
      { name: "b", config: { type: "remote", url: "https://b.example" } },
    ],
  })
})

test("a stored server opens in the form as it was written; the JSON tab shows the same record", () => {
  const form = formFromConfig("files", "project", {
    type: "local",
    command: ["npx", "-y", "srv"],
    environment: { A: "1" },
  })
  expect(form).toMatchObject({
    name: "files",
    scope: "project",
    kind: "local",
    command: "npx -y srv",
    environment: "A=1",
  })
  expect(JSON.parse(form.json)).toEqual({ type: "local", command: ["npx", "-y", "srv"], environment: { A: "1" } })
})
