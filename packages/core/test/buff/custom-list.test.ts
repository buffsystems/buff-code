// Список команд и субагентов для настроек (#446): свои файлы, реестр ядра и выключенные — в одну картину.
import { describe, expect, test } from "bun:test"
import { BuffCustomList } from "../../src/buff/custom-list.js"

const own = (id: string, scope: "user" | "project", values: Record<string, string> = {}) => ({
  id,
  scope,
  file: `/${scope}/commands/${id}.md`,
  values,
})

describe("entries", () => {
  test("an own file is listed by what the file says — the registry may not have re-read it yet", () => {
    expect(
      BuffCustomList.entries({
        own: [own("deploy", "user", { description: "Выкладка", agent: "build" })],
        registered: [{ id: "deploy", description: "старое" }],
        disabled: new Set(),
        configured: new Set(),
      }),
    ).toEqual([
      {
        id: "deploy",
        description: "Выкладка",
        scope: "user",
        path: "/user/commands/deploy.md",
        enabled: true,
        values: { description: "Выкладка", agent: "build" },
      },
    ])
  })

  test("the project file wins over the user file of the same name — as in the registry", () => {
    const entries = BuffCustomList.entries({
      own: [own("deploy", "user"), own("deploy", "project")],
      registered: [],
      disabled: new Set(),
      configured: new Set(),
    })
    expect(entries.map((entry) => entry.scope)).toEqual(["project"])
  })

  test("what is only in the registry is built in, unless a settings file names it", () => {
    const entries = BuffCustomList.entries({
      own: [],
      registered: [
        { id: "init", description: "Создать AGENTS.md" },
        { id: "lint", values: { mode: "subagent" } },
      ],
      disabled: new Set(),
      configured: new Set(["lint"]),
    })
    expect(entries).toEqual([
      { id: "init", description: "Создать AGENTS.md", scope: "builtin", enabled: true, values: {} },
      { id: "lint", scope: "config", enabled: true, values: { mode: "subagent" } },
    ])
  })

  test("an entry carries no empty fields — the answer must stay plain JSON", () => {
    const [entry] = BuffCustomList.entries({
      own: [],
      registered: [{ id: "init" }],
      disabled: new Set(),
      configured: new Set(),
    })
    expect(Object.keys(entry)).toEqual(["id", "scope", "enabled", "values"])
  })

  test("a disabled entry stays in the list, marked", () => {
    const entries = BuffCustomList.entries({
      own: [own("deploy", "user")],
      registered: [{ id: "init" }],
      disabled: new Set(["deploy", "init"]),
      configured: new Set(),
    })
    expect(entries.map((entry) => [entry.id, entry.enabled])).toEqual([
      ["deploy", false],
      ["init", false],
    ])
  })

  test("what needs a confirmation says whether it has one; the rest carries no such mark", () => {
    const entries = BuffCustomList.entries({
      own: [own("deploy", "project"), own("sync", "project"), own("mine", "user")],
      registered: [],
      disabled: new Set(),
      configured: new Set(),
      trust: new Map([
        ["deploy", true],
        ["sync", false],
      ]),
    })
    expect(entries.map((entry) => [entry.id, entry.trusted])).toEqual([
      ["deploy", true],
      ["mine", undefined],
      ["sync", false],
    ])
  })
})
