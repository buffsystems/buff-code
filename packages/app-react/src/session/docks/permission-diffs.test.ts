import { expect, test } from "bun:test"
import { permissionFileDiffs } from "./permission-diffs"

const patch = [
  "Index: README.md",
  "===================================================================",
  "--- README.md",
  "+++ README.md",
  "@@ -1,2 +1,3 @@",
  " # Tea shop",
  " 10% off from $40.",
  "+Discounts do not apply to gift sets.",
  "",
].join("\n")

test("an edit waiting for permission brings its diff, not only the file's name (#470)", () => {
  const diffs = permissionFileDiffs({ files: [{ file: "README.md", patch }] })
  expect(diffs.map((diff) => diff.file)).toEqual(["README.md"])
  expect(diffs[0]?.fileDiff.additionLines.join("")).toContain("Discounts do not apply to gift sets.")
})

test("a file given as before and after, and nothing for a request without files", () => {
  const diffs = permissionFileDiffs({ files: [{ file: "a.txt", before: "1\n", after: "2\n" }] })
  expect(diffs[0]?.fileDiff.additionLines.join("")).toContain("2")
  expect(permissionFileDiffs({})).toEqual([])
})
