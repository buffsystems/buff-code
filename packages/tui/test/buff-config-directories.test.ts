import { expect, test } from "bun:test"
import { configDirectories, projectConfigDirectories } from "../src/util/config-directories"

// #510: на каждом уровне — и апстримный .opencode, и свой .buffcode (свой позже — он перекрывает).
test("каталоги настроек TUI: .opencode и .buffcode на каждом уровне от корня вниз, свой — после апстримного", () => {
  expect(configDirectories("/cfg", "/a/b").filter((d) => d.startsWith("/a"))).toEqual([
    "/a/.opencode",
    "/a/.buffcode",
    "/a/b/.opencode",
    "/a/b/.buffcode",
  ])
  expect(projectConfigDirectories("/a", "/a/b")).toEqual(["/a/.opencode", "/a/.buffcode", "/a/b/.opencode", "/a/b/.buffcode"])
})
