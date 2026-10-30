// Сторож языка установщика консоли buff/install (#713, эпик #565): каждое сообщение — на русском
// и английском, язык — из --lang / BUFF_LANG, иначе из системы (LANGUAGE, LC_ALL, LC_MESSAGES,
// LANG), иначе русский. Установка гоняется целиком и без сети: зеркало — каталог по file://.
import { afterAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "..", "install")
const work = mkdtempSync(join(tmpdir(), "buff-install-"))
afterAll(() => rmSync(work, { recursive: true, force: true }))
const CYRILLIC = /[Ѐ-ӿ]/

function run(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(work, "home-"))
  writeFileSync(join(home, ".bashrc"), "")
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, ...env },
  })
  return { code: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr, home }
}

// Выпуск-заглушка: архив с «бинарём» под любую цель и список сумм рядом — как на зеркале.
const version = "9.9.9-buff.1"
const mirror = join(work, "mirror")
function release(sums: (archive: string, sum: string) => string) {
  const files = join(mirror, "downloads", version)
  const stage = join(work, "stage")
  mkdirSync(files, { recursive: true })
  mkdirSync(stage, { recursive: true })
  writeFileSync(join(stage, "buff"), "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 })
  const lines: string[] = []
  for (const os of ["linux", "darwin"])
    for (const arch of ["x64", "arm64"])
      for (const suffix of ["", "-baseline", "-musl", "-baseline-musl"]) {
        const archive = `buff-${os}-${arch}${suffix}.tar.gz`
        spawnSync("tar", ["-czf", join(files, archive), "-C", stage, "buff"])
        lines.push(`${sums(archive, createHash("sha256").update(readFileSync(join(files, archive))).digest("hex"))}  ${archive}`)
      }
  writeFileSync(join(files, "SHA256SUMS"), lines.join("\n") + "\n")
}
const fromMirror = (env: Record<string, string>) =>
  run([], { BUFF_SOURCE: "mirror", BUFF_BASE: `file://${mirror}`, BUFF_VERSION: version, ...env })

test("язык: ключ, BUFF_LANG, система, по умолчанию русский", () => {
  const english = (args: string[], env: Record<string, string>) => run([...args, "--help"], env).out.startsWith("Buff Code installer")
  expect(english([], { LANG: "en_US.UTF-8" })).toBe(true)
  expect(english([], {})).toBe(false)
  expect(english([], { LANG: "de_DE.UTF-8" })).toBe(false)
  expect(english([], { LANGUAGE: "de:en_GB", LANG: "ru_RU.UTF-8" })).toBe(true)
  expect(english([], { LC_ALL: "ru_RU.UTF-8", LANG: "en_US.UTF-8" })).toBe(false)
  expect(english([], { LC_MESSAGES: "en_US.UTF-8", LANG: "ru_RU.UTF-8" })).toBe(true)
  expect(english([], { BUFF_LANG: "en", LANG: "ru_RU.UTF-8" })).toBe(true)
  expect(english([], { BUFF_LANG: "ru", LANG: "en_US.UTF-8" })).toBe(false)
  expect(english(["--lang", "en"], { LANG: "ru_RU.UTF-8" })).toBe(true)
  expect(english(["--lang=ru"], { LANG: "en_US.UTF-8" })).toBe(false)
})

test("справка и ошибки ключей — на выбранном языке", () => {
  const en = run(["--lang", "en", "--bogus", "--help"])
  expect(en.code).toBe(0)
  expect(en.err).toContain("Unknown option: --bogus")
  expect(en.all).not.toMatch(CYRILLIC)
  expect(run(["--bogus", "--help"]).err).toContain("Неизвестный ключ: --bogus")
  for (const [args, ru, english] of [
    [["-v"], "нужна версия", "a version is needed"],
    [["-b"], "нужен путь к бинарю", "a path to the binary is needed"],
    [["-b", "/nonexistent/buff"], "Нет такого бинаря: /nonexistent/buff", "No such binary: /nonexistent/buff"],
  ] as const) {
    const ruRun = run([...args])
    expect(ruRun.code).toBe(1)
    expect(ruRun.err).toContain(ru)
    const enRun = run([...args], { BUFF_LANG: "en" })
    expect(enRun.code).toBe(1)
    expect(enRun.err).toContain(english)
    expect(enRun.all).not.toMatch(CYRILLIC)
  }
})

test("установка готового бинаря (как ставит десктоп) — на обоих языках", () => {
  const binary = join(work, "local", "buff")
  mkdirSync(join(work, "local"), { recursive: true })
  writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 })
  const en = run(["-b", binary], { LANG: "en_US.UTF-8" })
  expect(en.code).toBe(0)
  expect(en.out).toContain(`Done: ${en.home}/.buff/bin/buff`)
  expect(en.out).toContain(`Added to PATH: ${en.home}/.bashrc`)
  expect(en.out).toContain("Open a new shell or run: export PATH=")
  expect(en.all).not.toMatch(CYRILLIC)
  const ru = run(["-b", binary, "--no-modify-path"], { LANG: "ru_RU.UTF-8" })
  expect(ru.code).toBe(0)
  expect(ru.out).toContain(`Готово: ${ru.home}/.buff/bin/buff`)
  expect(ru.out).not.toContain("PATH")
  expect(readFileSync(join(ru.home, ".bashrc"), "utf8")).toBe("")
})

test("скачивание с зеркала со сверкой суммы — на обоих языках", () => {
  release((_, sum) => sum)
  const en = fromMirror({ LANG: "en_US.UTF-8" })
  expect(en.err).toBe("")
  expect(en.code).toBe(0)
  expect(en.out).toContain(`Installing buff ${version} (`)
  expect(en.out).toContain(`Downloaded from the mirror file://${mirror}`)
  expect(en.out).toContain("Checksum verified.")
  expect(en.out).toContain("Done: ")
  expect(en.all).not.toMatch(CYRILLIC)
  const ru = fromMirror({ BUFF_LANG: "ru", BUFF_INSTALL_DIR: join(work, "ru-bin") })
  expect(ru.code).toBe(0)
  expect(ru.out).toContain(`Ставлю buff ${version} (`)
  expect(ru.out).toContain(`Скачано: зеркало file://${mirror}`)
  expect(ru.out).toContain("Контрольная сумма сошлась.")
  expect(ru.out).toContain(`Готово: ${join(work, "ru-bin")}/buff`)
})

test("несошедшаяся сумма прерывает установку — на обоих языках", () => {
  release(() => "0".repeat(64))
  const en = fromMirror({ BUFF_LANG: "en" })
  expect(en.code).toBe(1)
  expect(en.err).toContain("Checksum mismatch — installation aborted.")
  expect(en.all).not.toMatch(CYRILLIC)
  const ru = fromMirror({})
  expect(ru.code).toBe(1)
  expect(ru.err).toContain("Контрольная сумма не сошлась — установка прервана.")
})

test("каждая русская строка скрипта идёт с английской парой", () => {
  const lines = readFileSync(script, "utf8").split("\n")
  const help = lines.findIndex((line) => line === "Установка Buff Code")
  expect(help).toBeGreaterThan(0)
  const helpEnd = lines.findIndex((line, i) => i > help && line === "TXT")
  const loose = lines
    .map((line, i) => ({ line: line.trim(), i }))
    .filter(({ line, i }) => CYRILLIC.test(line) && !line.startsWith("#") && (i < help || i > helpEnd))
    .filter(({ line }) => !/\b(say|warn|die) "[^"]*[Ѐ-ӿ][^"]*" "[^"Ѐ-ӿ]+"/.test(line))
    .map(({ line, i }) => `${i + 1}: ${line}`)
  expect(loose).toEqual([])
})
