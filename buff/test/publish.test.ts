// Заливка выпуска в реестр (#764): файл, который в реестре уже лежит ТЕМИ ЖЕ байтами, не льётся
// заново; лежащий другой сборкой — заменяется. Перевыпуск той же версии (исправления в рамках
// выпуска) иначе оставлял на зеркале файлы и суммы первой сборки, а на GitHub — новые.
import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

const lib = join(import.meta.dir, "..", "publish-lib.sh")

/** push_one с поддельным oras: манифест в реестре несёт `registryDigest` (пусто — тега нет). */
function pushOne(content: string, registryDigest: string) {
  const dir = mkdtempSync(join(tmpdir(), "publish-"))
  const log = join(dir, "oras.log")
  const oras = join(dir, "oras")
  writeFileSync(
    oras,
    `#!/usr/bin/env bash
echo "$*" >> ${log}
if [ "$1 $2" = "manifest fetch" ]; then
  [ -n "${registryDigest}" ] || exit 1
  echo '{"schemaVersion":2,"layers":[{"mediaType":"application/octet-stream","digest":"${registryDigest}","size":3,"annotations":{"org.opencontainers.image.title":"a.txt"}}]}'
fi
`,
  )
  chmodSync(oras, 0o755)
  writeFileSync(join(dir, "a.txt"), content)
  const run = Bun.spawnSync(["bash", "-c", `source ${lib}; push_one a.txt`], {
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH}`, VERSION: "0.28.0", REGISTRY: "r", REPO: "buff/downloads", ORAS_OPTS: "", PUBLISH_ATTEMPTS: "1" },
  })
  const calls = (() => {
    try {
      return readFileSync(log, "utf8")
    } catch {
      return ""
    }
  })()
  return { out: run.stdout.toString(), code: run.exitCode, pushed: calls.includes("push ") }
}

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex")

test("тех же байт в реестре — не льётся", () => {
  const r = pushOne("abc", sha("abc"))
  expect(r.code).toBe(0)
  expect(r.pushed).toBe(false)
  expect(r.out).toContain("уже в реестре")
})

test("в реестре другая сборка того же файла — заменяется", () => {
  const r = pushOne("abc", sha("old build"))
  expect(r.code).toBe(0)
  expect(r.pushed).toBe(true)
  expect(r.out).toContain("заменяю")
})

test("файла в реестре нет — льётся", () => {
  const r = pushOne("abc", "")
  expect(r.code).toBe(0)
  expect(r.pushed).toBe(true)
})
