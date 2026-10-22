import { expect, test } from "bun:test"
import type { MigrationV1StatusOutput } from "@opencode/client/promise"
import { migrationLabel, watchMigration } from "./migration-status"

const running = (numerator?: number, denominator?: number) =>
  ({ status: "running", progress: { label: "Moving sessions", numerator, denominator } }) as MigrationV1StatusOutput

test("the label shows what the server counted", () => {
  expect(migrationLabel(undefined)).toBe("")
  expect(migrationLabel({ label: "Moving sessions" })).toBe("Moving sessions")
  expect(migrationLabel({ label: "Moving sessions", numerator: 3 })).toBe("Moving sessions 3")
  expect(migrationLabel({ label: "Moving sessions", numerator: 3, denominator: 9 })).toBe("Moving sessions 3/9")
})

test("progress shows while running and clears when complete", async () => {
  const answers: MigrationV1StatusOutput[] = [running(1, 2), running(2, 2), { status: "completed" } as MigrationV1StatusOutput]
  const shown: (string | undefined)[] = []
  await watchMigration({
    status: async () => answers.shift()!,
    signal: new AbortController().signal,
    wait: async () => undefined,
    progress: (label) => shown.push(label),
    fail: () => undefined,
  })
  expect(shown).toEqual(["Moving sessions 1/2", "Moving sessions 2/2", undefined])
})

test("a failed migration is reported once", async () => {
  const failures: string[] = []
  await watchMigration({
    status: async () => ({ status: "error", error: "disk full" }) as MigrationV1StatusOutput,
    signal: new AbortController().signal,
    wait: async () => undefined,
    progress: () => undefined,
    fail: (message) => failures.push(message),
  })
  expect(failures).toEqual(["disk full"])
})
