// Что ждёт подтверждения в проекте (#446): хуки и команды — одним списком, для полосы над полем ввода и для /trust.
import { describe, expect, test } from "bun:test"
import { BuffTrust } from "../src/buff-trust.js"
import { BuffI18n } from "../src/buff-i18n.js"
import type { BuffCustom } from "../src/buff-custom.js"
import type { BuffHook } from "../src/buff-hook.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)

const command = (id: string, trusted?: boolean): BuffCustom.Entry => ({
  id,
  scope: "project",
  enabled: true,
  values: {},
  ...(trusted === undefined ? {} : { trusted }),
})
const hook = (id: string, trusted?: boolean): BuffHook.Entry => ({
  id,
  event: "tool.after",
  command: "make fmt",
  scope: trusted === undefined ? "user" : "project",
  path: "/p/.opencode/hooks.json",
  enabled: true,
  ...(trusted === undefined ? {} : { trusted }),
})

describe("what waits for a confirmation", () => {
  test("project hooks and commands that are not confirmed — hooks first", () => {
    expect(
      BuffTrust.pending(
        [command("deploy", false), command("ok", true), command("mine")],
        [hook("fmt", false), hook("own")],
        ru,
      ),
    ).toEqual([
      { kind: "hook", id: "fmt", title: "Хук «fmt»", note: "После инструмента · любой" },
      { kind: "command", id: "deploy", title: "Команда /deploy", note: "команда проекта" },
    ])
  })

  test("a switched-off entry does not ask for attention", () => {
    expect(
      BuffTrust.pending([{ ...command("deploy", false), enabled: false }], [{ ...hook("fmt", false), enabled: false }]),
    ).toEqual([])
  })
})

describe("the line above the input field", () => {
  const items = (hooks: number, commands: number) => [
    ...Array.from({ length: hooks }, (_, index) => ({ kind: "hook" as const, id: `h${index}`, title: "", note: "" })),
    ...Array.from({ length: commands }, (_, index) => ({
      kind: "command" as const,
      id: `c${index}`,
      title: "",
      note: "",
    })),
  ]

  test("says what waits and that it does not run meanwhile", () => {
    expect(BuffTrust.line(items(1, 0), ru, ruN)).toBe("1 хук проекта ждёт проверки и пока не выполняется.")
    expect(BuffTrust.line(items(2, 1), ru, ruN)).toBe("2 хука и 1 команда проекта ждут проверки и пока не выполняются.")
    expect(BuffTrust.line(items(0, 5), ru, ruN)).toBe("5 команд проекта ждут проверки и пока не выполняются.")
    expect(BuffTrust.line(items(21, 0), ru, ruN)).toBe("21 хук проекта ждёт проверки и пока не выполняется.")
    expect(BuffTrust.line(items(1, 0))).toBe("1 hook from the project is waiting for review and does not run yet.")
    expect(BuffTrust.line(items(2, 1))).toBe(
      "2 hooks and 1 command from the project are waiting for review and do not run yet.",
    )
  })

  test("nothing waits — no line", () => {
    expect(BuffTrust.line([])).toBeUndefined()
  })
})
