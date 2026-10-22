// Сканер строк интерфейса для переводов (#472): общий у сторожа и у пересчёта списка «ещё не переведено».
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export const root = join(import.meta.dir, "..", "..")
export const SOURCES = ["app/src", "session-ui/src", "schema/src", "tui/src", "core/src", "desktop/src", "ui/src", "cli/src"]
/** Каталоги переводов и словари апстрима — там русскому и место. */
const CATALOGS = [/\/buff-i18n\//, /\/runtime\/i18n\//, /^packages\/ui\/src\/i18n\//, /\/buff\/i18n\//]
const CYRILLIC = /[А-Яа-яЁё]/
/** Русский, которому место в коде, — строка файла и причина. */
const INTENDED: { path: string; line: RegExp; reason: string }[] = [
  {
    path: "packages/app/src/session/terminal/title.ts",
    line: /"Терминал \{\{number\}\}"/,
    reason: "старые названия вкладок из сохранённых данных апстрима — их узнают, а не показывают",
  },
  {
    path: "packages/core/src/buff/login.ts",
    line: /UNKNOWN_PATH = "нет такого адреса"/,
    reason: "так отвечает шлюз разработчика — по этому ответу узнаётся ошибка в адресе",
  },
  {
    path: "packages/core/src/buff/workflow-tools.ts",
    line: /\(сценарий \/ workflow\)/,
    reason: "описание для модели: русское слово, по которому человек просит сценарий",
  },
]

/** Файлы кода интерфейса: без тестов и историй. */
export function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === "node_modules") return []
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name) ? [path] : []
  })
}

/**
 * Сколько строк кода с русским текстом — без комментариев (строчных, блочных, в разметке и строк
 * многострочного комментария). Считаются и строки в кавычках, и текст в разметке — где бы он ни стоял.
 */
export function russianLiterals(source: string, intended: RegExp[] = []): number {
  let inBlock = false
  let count = 0
  for (const raw of source.split("\n")) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf("*/")
      if (end < 0) continue
      line = line.slice(end + 2)
      inBlock = false
    }
    line = line.replace(/\{?\/\*.*?\*\/\}?/g, "")
    const open = line.indexOf("/*")
    if (open >= 0) {
      inBlock = true
      line = line.slice(0, open)
    }
    if (/^\s*(\/\/|\*)/.test(line)) continue
    if (intended.some((re) => re.test(line))) continue
    if (CYRILLIC.test(line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))) count++
  }
  return count
}

/** Файлы с русскими строками вне каталогов и их число, по путям от корня репозитория. */
export function untranslated(): Record<string, number> {
  return Object.fromEntries(
    SOURCES.flatMap((dir) => files(join(root, "packages", dir)))
      .map((path) => relative(root, path))
      .map((path) => {
        const intended = INTENDED.filter((item) => item.path === path).map((item) => item.line)
        return [path, russianLiterals(readFileSync(join(root, path), "utf8"), intended)] as const
      })
      .filter(([path, count]) => count > 0 && !CATALOGS.some((re) => re.test(path)))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}
