// Управление MCP-серверами из интерфейса (#444): правила, общие для окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffMcp } from "../src/buff-mcp.js"

// #472: строки схемы — английские; русские ожидания — через русский перевод (он же проверяет каталог).
const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("server name", () => {
  test("a usable name passes", () => {
    expect(BuffMcp.nameProblem("github", ru)).toBeUndefined()
    expect(BuffMcp.nameProblem("my_server-2", ru)).toBeUndefined()
  })

  test("an empty or odd name says what a name looks like", () => {
    for (const name of ["", "  ", "my server", "сервер", "a/b", "a.b"])
      expect(BuffMcp.nameProblem(name, ru)).toBe("Имя — латинские буквы, цифры, дефис и подчёркивание, без пробелов.")
  })

  test("the names of Buff's own servers are taken", () => {
    for (const name of ["buff", "knowledge", "repos"])
      expect(BuffMcp.nameProblem(name, ru)).toBe(`Имя «${name}» занято встроенным сервером Buff — выберите другое.`)
  })
})

describe("server from JSON", () => {
  test("our own format is taken as it is", () => {
    expect(
      BuffMcp.fromJson('{ "type": "local", "command": ["npx", "-y", "srv"], "environment": { "A": "1" } }', ru),
    ).toEqual({
      servers: [{ config: { type: "local", command: ["npx", "-y", "srv"], environment: { A: "1" } } }],
    })
    expect(
      BuffMcp.fromJson('{ "type": "remote", "url": "https://mcp.example.com", "headers": { "X": "y" } }', ru),
    ).toEqual({
      servers: [{ config: { type: "remote", url: "https://mcp.example.com", headers: { X: "y" } } }],
    })
  })

  test("the format other agents use — command, args, env — becomes ours", () => {
    expect(BuffMcp.fromJson('{ "command": "npx", "args": ["-y", "srv"], "env": { "TOKEN": "t" } }', ru)).toEqual({
      servers: [{ config: { type: "local", command: ["npx", "-y", "srv"], environment: { TOKEN: "t" } } }],
    })
    expect(BuffMcp.fromJson('{ "url": "https://mcp.example.com/sse" }', ru)).toEqual({
      servers: [{ config: { type: "remote", url: "https://mcp.example.com/sse" } }],
    })
  })

  test("a whole mcpServers block brings every server with its name", () => {
    const text =
      '{ "mcpServers": { "files": { "command": "srv" }, "web": { "type": "http", "url": "https://w.example" } } }'
    expect(BuffMcp.fromJson(text, ru)).toEqual({
      servers: [
        { name: "files", config: { type: "local", command: ["srv"] } },
        { name: "web", config: { type: "remote", url: "https://w.example" } },
      ],
    })
  })

  test("comments and trailing commas are fine — it is what people paste", () => {
    expect(BuffMcp.fromJson('{\n  // сервер\n  "command": "srv",\n}', ru)).toEqual({
      servers: [{ config: { type: "local", command: ["srv"] } }],
    })
  })

  test("what cannot be read says why", () => {
    expect(BuffMcp.fromJson("{ nope", ru)).toEqual({ problem: "Это не JSON: проверьте скобки и кавычки." })
    expect(BuffMcp.fromJson('"строка"', ru)).toEqual({ problem: "Ожидается объект с описанием сервера." })
    expect(BuffMcp.fromJson('{ "name": "x" }', ru)).toEqual({
      problem: "В описании нет ни команды (command), ни адреса (url).",
    })
    expect(BuffMcp.fromJson('{ "mcpServers": {} }', ru)).toEqual({
      problem: "В блоке mcpServers нет ни одного сервера.",
    })
  })
})

describe("server config", () => {
  test("a local server needs a command, a remote one an http(s) address", () => {
    expect(BuffMcp.configProblem({ type: "local", command: [] }, ru)).toBe("Укажите команду запуска сервера.")
    expect(BuffMcp.configProblem({ type: "local", command: ["  "] }, ru)).toBe("Укажите команду запуска сервера.")
    expect(BuffMcp.configProblem({ type: "remote", url: "ftp://x" }, ru)).toBe(
      "Адрес сервера должен начинаться с http:// или https://.",
    )
    expect(BuffMcp.configProblem({ type: "remote", url: "nope" }, ru)).toBe(
      "Адрес сервера должен начинаться с http:// или https://.",
    )
    expect(BuffMcp.configProblem({ type: "local", command: ["srv"] }, ru)).toBeUndefined()
    expect(BuffMcp.configProblem({ type: "remote", url: "https://mcp.example.com" }, ru)).toBeUndefined()
  })
})

describe("status", () => {
  test("one wording for every place a server's status shows", () => {
    expect(BuffMcp.statusText({ status: "connected" }, ru)).toEqual({ tone: "ok", label: "Подключён" })
    expect(BuffMcp.statusText({ status: "pending" }, ru)).toEqual({ tone: "busy", label: "Подключается…" })
    expect(BuffMcp.statusText({ status: "disabled" }, ru)).toEqual({ tone: "off", label: "Выключен" })
    expect(BuffMcp.statusText({ status: "needs_auth", error: "401" }, ru)).toEqual({
      tone: "warn",
      label: "Нужен вход",
      reason: "401",
    })
  })

  test("a failure says what went wrong in plain words, the raw text stays as details", () => {
    expect(BuffMcp.statusText({ status: "failed", error: "spawn nope ENOENT" }, ru)).toEqual({
      tone: "fail",
      label: "Не запустился",
      reason: "Команда не найдена. Проверьте, что программа установлена и путь указан верно.",
      details: "spawn nope ENOENT",
    })
    expect(BuffMcp.statusText({ status: "failed", error: "Connection closed" }, ru)).toEqual({
      tone: "fail",
      label: "Не запустился",
      reason: "Сервер закрыл соединение сразу после запуска. Проверьте команду и её аргументы.",
      details: "Connection closed",
    })
    // Так отказ запуска называет само ядро.
    expect(
      BuffMcp.statusText({ status: "failed", error: "NotFound: ChildProcess.spawn (no-such-program --flag)" }, ru),
    ).toMatchObject({ reason: "Команда не найдена. Проверьте, что программа установлена и путь указан верно." })
    expect(BuffMcp.statusText({ status: "failed", error: "fetch failed" }, ru)).toMatchObject({
      reason: "Сервер по этому адресу не отвечает. Проверьте адрес и сеть.",
    })
    expect(
      BuffMcp.statusText({ status: "failed", error: "Unable to connect. Is the computer able to access the url?" }, ru),
    ).toMatchObject({ reason: "Сервер по этому адресу не отвечает. Проверьте адрес и сеть." })
    expect(BuffMcp.statusText({ status: "failed", error: "weird thing" }, ru)).toEqual({
      tone: "fail",
      label: "Не запустился",
      reason: "weird thing",
      details: "weird thing",
    })
  })
})

describe("form lines", () => {
  test("KEY=VALUE lines become a record and back", () => {
    expect(BuffMcp.pairs("A=1\n\n B = two words \nC=x=y")).toEqual({ A: "1", B: "two words", C: "x=y" })
    expect(BuffMcp.lines({ A: "1", B: "two words" })).toBe("A=1\nB=two words")
    expect(BuffMcp.lines(undefined)).toBe("")
  })

  test("a line without a key is named", () => {
    expect(BuffMcp.pairsProblem("A=1\nnope", ru)).toBe("Строка «nope» — не в виде ИМЯ=значение.")
    expect(BuffMcp.pairsProblem("A=1", ru)).toBeUndefined()
  })

  test("a command line splits into the program and its arguments, quotes kept together", () => {
    expect(BuffMcp.command('npx -y "@scope/server name" --flag')).toEqual(["npx", "-y", "@scope/server name", "--flag"])
    expect(BuffMcp.commandLine(["npx", "-y", "@scope/server name"])).toBe('npx -y "@scope/server name"')
  })
})

describe("серверы Buff Code в списке (#470)", () => {
  test("у каждого встроенного — пояснение, что он даёт модели", () => {
    for (const name of BuffMcp.BUILTIN) expect(BuffMcp.builtinHint(name)?.length ?? 0).toBeGreaterThan(10)
    expect(BuffMcp.builtinHint("repos", (text) => (text.includes("read only") ? "только чтение" : text))).toBe(
      "только чтение",
    )
    expect(BuffMcp.builtinHint("my-server")).toBeUndefined()
  })

  test("запрос сервера назван по-человечески: встроенный — словами, свой — своим именем", () => {
    const ru = (text: string, params?: Record<string, string | number>) =>
      ({ "Knowledge base": "База знаний", "Request from «{server}»": "Запрос от «{server}»" })[text]?.replace(
        "{server}",
        String(params?.server),
      ) ?? text
    expect(BuffMcp.requestTitle("knowledge", ru)).toBe("Запрос от «База знаний»")
    expect(BuffMcp.requestTitle("jira-local", ru)).toBe("Запрос от «jira-local»")
    for (const name of BuffMcp.BUILTIN) expect(BuffMcp.requestTitle(name)).not.toContain(`«${name}»`)
  })

  test("строки сообщения сервера не слипаются: одиночный перенос остаётся переносом", () => {
    expect(BuffMcp.messageMarkdown("имя: x\nПравило: y\n\n- a\n- b")).toBe("имя: x  \nПравило: y\n\n- a  \n- b")
  })
})
