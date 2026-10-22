import { expect, test } from "bun:test"
import path from "node:path"
import { serverLogRoots } from "./server-logs"

test("log export looks where the server writes its logs — the buff directories", () => {
  expect(serverLogRoots(path.join, "/home/u/.local/share", "/home/u/.config/Buff Code")).toEqual([
    "/home/u/.local/share/buff/log",
    "/home/u/.config/Buff Code/buff/log",
  ])
})
