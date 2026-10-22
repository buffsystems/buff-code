// Git из интерфейса (#454): разбор вывода git и правила, общие для ядра, окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffGit } from "../src/buff-git.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("what changed in the working copy", () => {
  test("each file once, with what happened to it", () => {
    const out = [" M src/a.ts", "?? notes.txt", "A  new.ts", " D gone.ts", "D  staged-gone.ts", ""].join("\0")
    expect(BuffGit.changes(out)).toEqual([
      { file: "src/a.ts", status: "modified" },
      { file: "notes.txt", status: "added" },
      { file: "new.ts", status: "added" },
      { file: "gone.ts", status: "deleted" },
      { file: "staged-gone.ts", status: "deleted" },
    ])
  })

  test("a rename is one change that knows both names — it is committed whole", () => {
    expect(BuffGit.changes(["R  new-name.ts", "old-name.ts", ""].join("\0"))).toEqual([
      { file: "new-name.ts", status: "renamed", from: "old-name.ts" },
    ])
    expect(BuffGit.paths([{ file: "new-name.ts", status: "renamed", from: "old-name.ts" }])).toEqual([
      "new-name.ts",
      "old-name.ts",
    ])
  })

  test("a conflict is named as such", () => {
    expect(BuffGit.changes(["UU both.ts", ""].join("\0"))).toEqual([{ file: "both.ts", status: "conflict" }])
  })
})

describe("what git is asked to stage before a commit", () => {
  test("only what git does not know yet — a deletion is already known and must not be added", () => {
    // Удалённый файл, чьё удаление уже в индексе, git add не находит и отказывает всему коммиту.
    expect(
      BuffGit.toStage([
        { file: "gone.ts", status: "deleted" },
        { file: "a.ts", status: "modified" },
        { file: "new.ts", status: "added" },
        { file: "new-name.ts", status: "renamed", from: "old-name.ts" },
        { file: "both.ts", status: "conflict" },
      ]),
    ).toEqual(["new.ts", "new-name.ts", "both.ts"])
  })
})

describe("ahead and behind", () => {
  test("is read from the counts and said in words", () => {
    expect(BuffGit.aheadBehind("2\t5\n")).toEqual({ ahead: 2, behind: 5 })
    expect(BuffGit.syncLabel({ ahead: 2, behind: 5, upstream: "origin/main" }, ru)).toBe("впереди 2 · позади 5")
    expect(BuffGit.syncLabel({ ahead: 0, behind: 0, upstream: "origin/main" }, ru)).toBe("совпадает с origin/main")
    expect(BuffGit.syncLabel({ ahead: 3, behind: 0 }, ru)).toBe("ещё не отправлена")
    expect(BuffGit.syncLabel({ ahead: 2, behind: 5, upstream: "origin/main" })).toBe("ahead 2 · behind 5")
  })
})

describe("a branch name", () => {
  test("what git would refuse is refused with words", () => {
    expect(BuffGit.branchProblem("feature/login", ["main"], ru)).toBeUndefined()
    expect(BuffGit.branchProblem(" ", [], ru)).toBe("Назовите ветку.")
    expect(BuffGit.branchProblem("my branch", [], ru)).toBe(
      "В имени ветки не бывает пробелов и знаков ~ ^ : ? * [ \\ — например feature/login.",
    )
    expect(BuffGit.branchProblem("main", ["main"], ru)).toBe("Ветка «main» уже есть.")
    expect(BuffGit.branchProblem("-x", [], ru)).toBe("Имя ветки не начинается с дефиса.")
  })
})

describe("a commit", () => {
  test("needs a message and something to commit", () => {
    expect(BuffGit.commitProblem({ message: " ", files: ["a"] }, ru)).toBe("Напишите сообщение коммита.")
    expect(BuffGit.commitProblem({ message: "fix", files: [] }, ru)).toBe("Отметьте, какие файлы войдут в коммит.")
    expect(BuffGit.commitProblem({ message: "fix", files: ["a"] }, ru)).toBeUndefined()
  })
})

describe("why a push failed — in words", () => {
  test("the usual reasons", () => {
    expect(BuffGit.pushProblem("! [rejected] main -> main (non-fast-forward)", ru)).toBe(
      "На сервере есть коммиты, которых нет у вас. Сначала заберите их (git pull), затем отправьте снова.",
    )
    expect(BuffGit.pushProblem("fatal: Authentication failed for 'https://x'", ru)).toBe(
      "Сервер не принял учётные данные. Проверьте доступ к репозиторию.",
    )
    expect(BuffGit.pushProblem("fatal: 'origin' does not appear to be a git repository", ru)).toBe(
      "У репозитория нет удалённого адреса origin — отправлять некуда.",
    )
    expect(BuffGit.pushProblem("что-то ещё", ru)).toBe("что-то ещё")
  })
})

describe("history", () => {
  const line = (...parts: string[]) => parts.join("\x1f")
  const out = [
    line("c3", "c2 b1", "Merge branch", "Анна", "1700000300", "HEAD -> main, origin/main"),
    line("b1", "c1", "feature work", "Борис", "1700000200", "feature"),
    line("c2", "c1", "main work", "Анна", "1700000100", ""),
    line("c1", "", "init", "Анна", "1700000000", ""),
  ].join("\x1e")

  test("commits are read with their parents and names", () => {
    expect(BuffGit.commits(out)[0]).toEqual({
      hash: "c3",
      parents: ["c2", "b1"],
      subject: "Merge branch",
      author: "Анна",
      time: 1700000300000,
      refs: ["HEAD -> main", "origin/main"],
    })
    expect(BuffGit.commits("")).toEqual([])
  })

  test("the graph gives each line of work its own column and joins them at merges", () => {
    expect(
      BuffGit.graph(BuffGit.commits(out)).map((row) => [row.commit.hash, row.column, row.columns, row.links]),
    ).toEqual([
      [
        "c3",
        0,
        1,
        [
          { from: 0, to: 0 },
          { from: 0, to: 1 },
        ],
      ],
      [
        "b1",
        1,
        2,
        [
          { from: 0, to: 0 },
          { from: 1, to: 1 },
        ],
      ],
      [
        "c2",
        0,
        2,
        [
          { from: 0, to: 0 },
          { from: 1, to: 0 },
        ],
      ],
      ["c1", 0, 1, []],
    ])
  })
})

test("a change is said in a word — in the person's language", () => {
  expect(BuffGit.changeLabel({ file: "b.ts", status: "renamed", from: "a.ts" }, ru)).toBe("переименован из a.ts")
  expect(BuffGit.changeLabel({ file: "b.ts", status: "added" }, ru)).toBe("новый")
  expect(BuffGit.changeLabel({ file: "b.ts", status: "modified" })).toBe("modified")
})
