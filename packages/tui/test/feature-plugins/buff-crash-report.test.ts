// Отчёт о сбое консоли (#462): текст для письма в нашу поддержку вместо ссылки на трекер апстрима.
import { expect, test } from "bun:test"
import { crashReport, CRASH_SUPPORT } from "../../src/feature-plugins/buff/crash-report"

const report = crashReport({
  message: "boom",
  stack: "Error: boom\n    at run (app.tsx:1:1)",
  version: "2.0.11-buff.16",
  os: "linux x64",
  terminal: "xterm-256color",
})

test("the report names what crashed, where, and carries the whole stack", () => {
  expect(report).toContain("Buff Code 2.0.11-buff.16")
  expect(report).toContain("linux x64")
  expect(report).toContain("xterm-256color")
  expect(report).toContain("boom")
  expect(report).toContain("at run (app.tsx:1:1)")
})

test("the report goes to our support, not to the upstream tracker", () => {
  expect(CRASH_SUPPORT).toBe("support@buff.systems")
  expect(report).not.toContain("github.com")
})
