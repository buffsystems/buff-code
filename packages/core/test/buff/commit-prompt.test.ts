// Сообщение коммита от модели (#454): что отправляем и как чистим ответ.
import { expect, test } from "bun:test"
import { commitMessage, commitPrompt, newFilesMissingFromDiff } from "../../src/buff/commit-prompt.js"

test("the request carries the recent messages, the files and the changes", () => {
  const prompt = commitPrompt({ recent: "fix: поправить вход", files: "M src/a.ts", diff: "+строка" })
  expect(prompt).toContain("fix: поправить вход")
  expect(prompt).toContain("M src/a.ts")
  expect(prompt).toContain("+строка")
  expect(prompt).not.toContain("{{")
})

test("no history and only new files are said plainly", () => {
  const prompt = commitPrompt({ recent: "", files: "A notes.txt", diff: "" })
  expect(prompt).toContain("(none)")
  expect(prompt).toContain("(only new files — see the list)")
})

test("without history the message is asked in the person's language", () => {
  expect(commitPrompt({ recent: "", files: "A notes.txt", diff: "" })).toContain("if there are none — Russian")
})

test("the answer is freed from quotes and code fences", () => {
  expect(commitMessage("```\nfix: поправить вход\n```")).toBe("fix: поправить вход")
  expect(commitMessage("«fix: поправить вход»")).toBe("fix: поправить вход")
  expect(commitMessage("fix: вход\n\nПочему: падал.")).toBe("fix: вход\n\nПочему: падал.")
})

// #470: новые файлы, которых git ещё не знает, в «git diff HEAD» не попадают — модель тянулась их
// прочитать инструментом и отвечала не текстом, сообщение выходило пустым.
test("new files missing from the diff are picked out to be shown in full", () => {
  const diff = "diff --git a/src/cart.js b/src/cart.js\n+строка\ndiff --git a/notes.md b/notes.md\nnew file mode 100644"
  expect(
    newFilesMissingFromDiff(
      [
        { file: "src/cart.js", status: "modified" },
        { file: "notes.md", status: "added" },
        { file: "stock.txt", status: "added" },
        { file: "old.txt", status: "deleted" },
      ],
      diff,
    ),
  ).toEqual(["stock.txt"])
})

test("an empty answer is no message", () => {
  expect(commitMessage("   \n")).toBe("")
  expect(commitMessage("```\n```")).toBe("")
})
