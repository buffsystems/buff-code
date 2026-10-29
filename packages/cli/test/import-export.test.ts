// Buff (#468): выгрузка сессии в файл и загрузка из файла убраны решением владельца —
// в консоли нет ни `session export`, ни `session import`.
import { expect, test } from "bun:test"
import path from "node:path"

// Ошибки и справка — на языке системы (#713); здесь проверяется английский текст.
function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    env: { ...process.env, LANGUAGE: "en" },
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
}

test("session help offers neither export nor import", async () => {
  const [stdout, , exitCode] = await run(["session", "--help"])
  expect(exitCode).toBe(0)
  expect(stdout).toContain("list")
  expect(stdout).toContain("delete")
  expect(stdout).not.toContain("export")
  expect(stdout).not.toContain("import")
})

for (const command of ["export", "import"])
  test(`session ${command} is not a command`, async () => {
    const [stdout, stderr, exitCode] = await run(["session", command, "ses_any"])
    expect(exitCode).not.toBe(0)
    expect(stdout + stderr).toContain(`Unknown subcommand "${command}"`)
  })
