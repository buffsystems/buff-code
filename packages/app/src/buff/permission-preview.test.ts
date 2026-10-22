// Buff (#470): в режиме «Спрашивать» человек решает, видя саму правку, а не только имя файла.
import { expect, test } from "bun:test"
import { permissionDiffs } from "./permission-preview"

test("правка из запроса — файл и его патч", () => {
  const metadata = { files: [{ file: "README.md", patch: "@@ -1 +1,2 @@\n a\n+b", additions: 1, deletions: 0 }] }
  expect(permissionDiffs(metadata)).toEqual([{ file: "README.md", patch: "@@ -1 +1,2 @@\n a\n+b" }])
})

test("до и после вместо патча — тоже правка", () => {
  expect(permissionDiffs({ files: [{ file: "a.txt", before: "x", after: "y" }] })).toEqual([
    { file: "a.txt", before: "x", after: "y" },
  ])
})

test("без файлов или с чужими данными — нечего показывать", () => {
  expect(permissionDiffs(undefined)).toEqual([])
  expect(permissionDiffs({ files: "nope" })).toEqual([])
  expect(permissionDiffs({ files: [{ path: "a" }, { file: 3, patch: "x" }, { file: "b" }] })).toEqual([])
})
