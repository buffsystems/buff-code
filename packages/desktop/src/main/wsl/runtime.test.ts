import { expect, test } from "bun:test"
import { listInstalledWslDistros, probeWslRuntime, runWslSh, shellEscape, wslArgs, wslCliInstallCommand } from "./runtime"

test("wslArgs bypasses the distro default shell", () => {
  expect(wslArgs(["sh", "-lc", 'printf "%s\\n" "$HOME"'], "Debian")).toEqual([
    "-d",
    "Debian",
    "--exec",
    "sh",
    "-lc",
    'printf "%s\\n" "$HOME"',
  ])
  expect(wslArgs(["bash", "-se"], "Debian", "root")).toEqual([
    "-d",
    "Debian",
    "--user",
    "root",
    "--exec",
    "bash",
    "-se",
  ])
})

// Exercise the real wsl.exe argv path: with `--`, WSL routes the command line through the distro's
// default shell, which expands `$cli` to "" before `sh` runs the script (#48640).
const distro =
  process.platform === "win32" && (await probeWslRuntime()).available
    ? (await listInstalledWslDistros().catch(() => [])).find((item) => item.isDefault)?.name
    : undefined

test.skipIf(!distro)("inline scripts keep their own variable expansion inside WSL", async () => {
  const result = await runWslSh(['cli="from-script"', 'printf "%s\\n" "$cli"'].join("\n"), distro)
  expect(result.code).toBe(0)
  expect(result.stdout.trim()).toBe("from-script")
})

test("WSL installs Buff's console — the desktop's own binary or the release archive, never upstream's installer", () => {
  const local = wslCliInstallCommand({ version: "2.0.11-buff.25", binary: "C:\\Buff\\buff" })
  expect(local).toContain(`cp "$(wslpath -a ${shellEscape("C:\\Buff\\buff")})" "$stage/buff"`)
  const release = wslCliInstallCommand({ version: "2.0.11-buff.25" }, "linux-x64-baseline")
  expect(release).toContain("https://buff.systems/downloads/2.0.11-buff.25/buff-linux-x64-baseline.tar.gz")
  for (const script of [local, release]) {
    expect(script).toContain(`destination="$HOME"/'.buff/bin'`)
    expect(script).not.toContain("githubusercontent")
  }
  expect(() => wslCliInstallCommand({ version: "2.0.11-buff.25" })).toThrow()
})
