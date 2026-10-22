// Сторож выключенных функций. Падает после подъёма апстрима, если пункт, убранный решением
// владельца, вернулся в интерфейс: каждое место, где апстрим его показывает, обязано
// спрашивать BuffFeatures.
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

/** Строка с меткой и её окрестность — условие показа стоит рядом с пунктом. */
function guardedBy(file: string, mark: string, guard: string) {
  const lines = read(file).split("\n")
  const hits = lines.flatMap((line, index) => (line.includes(mark) ? [index] : []))
  expect(hits.length).toBeGreaterThan(0)
  for (const index of hits) expect(lines.slice(Math.max(0, index - 5), index + 2).join("\n")).toContain(guard)
}

test("экспорт и импорт сессии убраны из десктопа (#468)", () => {
  const guard = "BuffFeatures.sessionTransfer"
  guardedBy("packages/app/src/home/sessions/view.tsx", "props.onExportSession(", guard)
  guardedBy("packages/app/src/session/timeline/message-timeline.tsx", "props.action.export(", guard)
  guardedBy("packages/app/src/session/commands/use-session-commands.tsx", 'id: "session.export"', guard)
  guardedBy("packages/app/src/session/files/session-context-tab.tsx", "onClick={exportSession}", guard)
  guardedBy("packages/app/src/home/projects/controller.tsx", "canImportSession:", guard)
})

test("экспорт сессии убран из консоли (#468)", () => {
  guardedBy("packages/tui/src/routes/session/index.tsx", 'id: "session.export"', "BuffFeatures.sessionTransfer")
  const commands = read("packages/cli/src/commands/commands.ts")
  expect(commands).not.toContain('Spec.make("export"')
  expect(commands).not.toContain('Spec.make("import"')
})
