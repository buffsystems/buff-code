import { expect, test } from "bun:test"
import { fileOnDisk } from "./project-home"

test("a file of the tree is opened where the project is, not where the app runs", () => {
  expect(fileOnDisk("/home/me/notes-api", "src/a.ts")).toBe("/home/me/notes-api/src/a.ts")
  expect(fileOnDisk("/home/me/notes-api/", "README.md")).toBe("/home/me/notes-api/README.md")
  // A path already whole stays as it is.
  expect(fileOnDisk("/home/me/notes-api", "/etc/hosts")).toBe("/etc/hosts")
  expect(fileOnDisk("C:\\work\\api", "C:\\work\\api\\a.ts")).toBe("C:\\work\\api\\a.ts")
  // A Windows folder is joined the Windows way.
  expect(fileOnDisk("C:\\work\\api", "src/a.ts")).toBe("C:\\work\\api\\src\\a.ts")
})
