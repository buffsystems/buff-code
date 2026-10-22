// Откат в консоли (#449): перед откатом — что вернётся; при чужих правках — выбор, трогать ли файлы.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffTurnFlow } from "../src/buff-turn-flow.js"
import type { BuffMcpFlow } from "../src/buff-mcp-flow.js"
import type { BuffTurn } from "../src/buff-turn.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)

function ui(answers: unknown[]) {
  const asked: string[] = []
  const shown: string[] = []
  const next = (title: string) => {
    asked.push(title)
    return Promise.resolve(answers.shift())
  }
  const dialogs: BuffMcpFlow.Ui = {
    select: (dialog) => next(dialog.title) as never,
    prompt: (dialog) => next(dialog.title) as Promise<string | undefined>,
    confirm: (dialog) => {
      shown.push(dialog.message)
      return next(dialog.title) as Promise<boolean | undefined>
    },
  }
  return { dialogs, asked, shown }
}

const file = (name: string, external = false): BuffTurn.File => ({
  file: name,
  additions: 2,
  deletions: 1,
  status: "modified",
  external,
})

describe("a safe revert", () => {
  test("shows what comes back and asks once", async () => {
    const { dialogs, asked, shown } = ui([true])
    expect(await BuffTurnFlow.confirm(dialogs, { snapshots: true, files: [file("src/a.ts"), file("b.ts")] }, ru, ruN)).toEqual({
      files: true,
    })
    expect(asked).toEqual(["Откат безопасен"])
    expect(shown[0]).toBe(
      "Файлы вернутся к состоянию до хода. После отката можно вернуть всё как было.\n\n  src/a.ts  +2 −1\n  b.ts  +2 −1",
    )
  })

  test("a refusal or leaving the question reverts nothing", async () => {
    expect(await BuffTurnFlow.confirm(ui([false]).dialogs, { snapshots: true, files: [file("a.ts")] })).toBeUndefined()
    expect(await BuffTurnFlow.confirm(ui([undefined]).dialogs, { snapshots: true, files: [] })).toBeUndefined()
  })
})

describe("a revert over someone's later edits", () => {
  const preview = { snapshots: true, files: [file("a.ts"), file("b.ts", true)] }

  test("marks the files changed after the turn and lets one keep the files", async () => {
    const { dialogs, asked, shown } = ui([true, "chat"])
    expect(await BuffTurnFlow.confirm(dialogs, preview, ru, ruN)).toEqual({ files: false })
    expect(asked).toEqual(["Есть правки, сделанные после хода", "Что откатить"])
    expect(shown[0]).toContain("  b.ts  +2 −1  ← изменён после хода")
  })

  test("or overwrite them knowingly", async () => {
    expect(await BuffTurnFlow.confirm(ui([true, "files"]).dialogs, preview)).toEqual({ files: true })
    expect(await BuffTurnFlow.confirm(ui([true, undefined]).dialogs, preview)).toBeUndefined()
  })
})

test("after a turn: what it changed and how to take it back", () => {
  expect(BuffTurnFlow.footer([file("a.ts"), file("b.ts")], ru, ruN)).toBe("Изменено 2 файла  +4 −2 · /undo — откатить")
  expect(BuffTurnFlow.footer([file("a.ts")])).toBe("Changed 1 file  +2 −1 · /undo — rewind")
  expect(BuffTurnFlow.footer([])).toBeUndefined()
})
