// Сводка изменений хода и безопасный откат (#449): правила, общие для ядра, окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffTurn } from "../src/buff-turn.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)

const file = (
  name: string,
  additions: number,
  deletions: number,
  more: Partial<BuffTurn.File> = {},
): BuffTurn.File => ({
  file: name,
  additions,
  deletions,
  status: "modified",
  external: false,
  ...more,
})

describe("what a turn changed — in one line", () => {
  test("the number of files in the right form, with added and removed lines", () => {
    expect(BuffTurn.changedLine([file("a.ts", 4, 0)], ruN)).toBe("Изменён 1 файл  +4 −0")
    expect(BuffTurn.changedLine([file("a.ts", 1, 1), file("b.ts", 2, 3)], ruN)).toBe("Изменено 2 файла  +3 −4")
    expect(BuffTurn.changedLine(Array.from({ length: 5 }, (_, index) => file(`f${index}`, 1, 0)), ruN)).toBe(
      "Изменено 5 файлов  +5 −0",
    )
  })

  test("a turn that changed nothing has no line", () => {
    expect(BuffTurn.changedLine([], ruN)).toBeUndefined()
  })

  test("what happened to each file", () => {
    expect(BuffTurn.fileNote(file("a.ts", 3, 1), ru)).toBe("+3 −1")
    expect(BuffTurn.fileNote(file("a.ts", 3, 0, { status: "added" }), ru)).toBe("новый · +3 −0")
    expect(BuffTurn.fileNote(file("a.ts", 0, 9, { status: "deleted" }), ru)).toBe("удалён · +0 −9")
  })
})

describe("which files a revert brings back", () => {
  const step = (start: string, end: string, files: string[]) => ({
    type: "assistant" as const,
    snapshot: { start, end, files },
  })

  test("each file returns to how it was before the earliest step that touched it", () => {
    expect(
      BuffTurn.plan([step("s1", "s2", ["a.ts"]), { type: "user" as const }, step("s2", "s3", ["a.ts", "b.ts"])]),
    ).toEqual({ files: ["a.ts", "b.ts"], from: "s1", to: "s3" })
  })

  test("steps without a snapshot bring nothing back", () => {
    expect(BuffTurn.plan([{ type: "assistant" as const }, { type: "user" as const }])).toEqual({ files: [] })
  })
})

describe("is it safe to revert", () => {
  test("safe when nothing was touched after the agent", () => {
    expect(BuffTurn.verdict({ snapshots: true, files: [file("a.ts", 1, 0)] }, ru, ruN)).toEqual({
      safe: true,
      title: "Откат безопасен",
      text: "Файлы вернутся к состоянию до хода. После отката можно вернуть всё как было.",
    })
  })

  test("unsafe when a file was changed outside the agent after the turn", () => {
    expect(
      BuffTurn.verdict(
        { snapshots: true, files: [file("a.ts", 1, 0), file("b.ts", 2, 0, { external: true })] },
        ru,
        ruN,
      ),
    ).toEqual({
      safe: false,
      title: "Есть правки, сделанные после хода",
      text: "1 файл изменён уже после хода — не агентом. Откат заменит его версией до хода, эти правки пропадут из рабочей копии.",
    })
  })

  test("a turn that touched no files only rewinds the conversation", () => {
    expect(BuffTurn.verdict({ snapshots: true, files: [] }, ru, ruN)).toEqual({
      safe: true,
      title: "Откат переписки",
      text: "Файлы этот ход не менял. Сообщения после этого места будут убраны из переписки.",
    })
  })

  test("without snapshots files are not brought back — and it is said", () => {
    expect(BuffTurn.verdict({ snapshots: false, files: [] }, ru, ruN)).toEqual({
      safe: true,
      title: "Откат переписки",
      text: "Снимки файлов здесь не ведутся (каталог не под git или снимки выключены) — файлы останутся как есть. Сообщения после этого места будут убраны из переписки.",
    })
  })
})

describe("after a revert", () => {
  test("says what was rewound and that it can be brought back", () => {
    expect(BuffTurn.revertedLine(2, ru, ruN)).toBe("Ход откачен: 2 файла возвращены к прежнему состоянию.")
    expect(BuffTurn.revertedLine(1, ru, ruN)).toBe("Ход откачен: 1 файл возвращён к прежнему состоянию.")
    expect(BuffTurn.revertedLine(0, ru, ruN)).toBe("Ход откачен: сообщения убраны из переписки, файлы не менялись.")
    expect(BuffTurn.revertedLine(2)).toBe("Turn rewound: 2 files are back to their previous state.")
  })
})
