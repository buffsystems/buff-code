// Коммит и отправка из консоли (#454): шаги вопросами по очереди; диалог приходит снаружи.
import { describe, expect, test } from "bun:test"
import { BuffGitFlow } from "../src/buff-git-flow.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)
import type { BuffGit } from "../src/buff-git.js"
import type { BuffMcpFlow } from "../src/buff-mcp-flow.js"

function ui(answers: unknown[]) {
  const asked: string[] = []
  const shown: unknown[] = []
  const next = (title: string, extra?: unknown) => {
    asked.push(title)
    shown.push(extra)
    return Promise.resolve(answers.shift())
  }
  const dialogs: BuffMcpFlow.Ui = {
    select: (dialog) => next(dialog.title) as never,
    prompt: (dialog) => next(dialog.title, dialog.value) as Promise<string | undefined>,
    confirm: (dialog) => next(dialog.title, dialog.message) as Promise<boolean | undefined>,
  }
  return { dialogs, asked, shown }
}

const state = (changes: BuffGit.Change[]): BuffGit.State => ({ branch: "main", ahead: 0, behind: 0, changes })
const two = state([
  { file: "a.ts", status: "modified" },
  { file: "b.ts", status: "added" },
])

describe("commit", () => {
  test("shows what goes in, offers a composed message, asks whether to push", async () => {
    const { dialogs, asked, shown } = ui([true, "fix: поправить вход", "push"])
    expect(await BuffGitFlow.commit(dialogs, two, async () => "fix: сочинённое", ru, ruN)).toEqual({
      files: ["a.ts", "b.ts"],
      message: "fix: поправить вход",
      push: true,
    })
    expect(asked).toEqual(["Закоммитить 2 файла?", "Сообщение коммита", "Отправить на сервер?"])
    expect(shown[0]).toBe("  изменён: a.ts\n  новый: b.ts")
    expect(shown[1]).toBe("fix: сочинённое")
  })

  test("the message is asked even when composing failed", async () => {
    const { dialogs, shown } = ui([true, "fix: руками", "keep"])
    const result = await BuffGitFlow.commit(dialogs, two, () => Promise.reject(new Error("модель недоступна")), ru, ruN)
    expect(result).toEqual({ files: ["a.ts", "b.ts"], message: "fix: руками", push: false })
    expect(shown[1]).toBe("")
  })

  test("nothing to commit — says so; an empty message or leaving commits nothing", async () => {
    expect(await BuffGitFlow.commit(ui([]).dialogs, state([]), async () => "", ru, ruN)).toEqual({
      problem: "Рабочая копия чистая — коммитить нечего.",
    })
    expect(await BuffGitFlow.commit(ui([true, "  "]).dialogs, two, async () => "", ru, ruN)).toEqual({
      problem: "Напишите сообщение коммита.",
    })
    expect(await BuffGitFlow.commit(ui([false]).dialogs, two, async () => "")).toBeUndefined()
  })
})

describe("push", () => {
  test("says what will be sent and asks", async () => {
    const { dialogs, asked } = ui([true])
    expect(await BuffGitFlow.push(dialogs, { ...two, ahead: 2, upstream: "origin/main" }, ru)).toBe(true)
    expect(asked).toEqual(["Отправить ветку main? (впереди 2)"])
  })

  test("nothing to send or no branch — says so", async () => {
    expect(await BuffGitFlow.push(ui([]).dialogs, { ...two, upstream: "origin/main" }, ru)).toEqual({
      problem: "Отправлять нечего: ветка совпадает с origin/main.",
    })
    expect(await BuffGitFlow.push(ui([]).dialogs, { ahead: 0, behind: 0, changes: [] }, ru)).toEqual({
      problem: "HEAD не на ветке — отправлять нечего.",
    })
  })
})
