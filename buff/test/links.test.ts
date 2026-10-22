// Сторож ссылок (#462). Помощь, поддержка и «что нового» ведут на наши адреса; после подъёма
// апстрима тест падает, если где-то снова появился его сайт, Discord или трекер.
import { test, expect } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { BuffLinks } from "../../packages/schema/src/buff-links"

const root = join(import.meta.dir, "..", "..")
const brand = JSON.parse(readFileSync(join(root, "buff/brand.json"), "utf8"))

test("адреса согласованы с brand.json", () => {
  expect(BuffLinks.site).toBe(brand.site)
  expect(BuffLinks.docs.startsWith(brand.docs)).toBe(true)
  expect(BuffLinks.changelog.startsWith(brand.updateApi)).toBe(true)
  expect(BuffLinks.latestCli.startsWith(brand.updateApi)).toBe(true)
  expect(BuffLinks.downloads).toBe(`${brand.site}/downloads`)
  expect(BuffLinks.support).toBe(`mailto:${brand.support}`)
})

test("письмо в поддержку открывается с темой", () => {
  expect(BuffLinks.supportMail("Сбой: окно не открылось")).toBe(
    `mailto:${brand.support}?subject=${encodeURIComponent("Сбой: окно не открылось")}`,
  )
})

// Где искать: исходники интерфейсов и главного процесса. Переводы апстрима не правим — имя
// продукта в них подставляется при загрузке, а адресов в них нет.
const SCANNED = ["packages/app/src", "packages/desktop/src", "packages/tui/src", "packages/cli/src", "packages/ui/src"]
const SKIPPED = /(\.test\.tsx?|\.stories\.tsx|\/i18n\/|\/storybook\/)/
// Установщик и пакеты апстрима (#597): удалённые серверы десктопа ставили оттуда чужую консоль.
const UPSTREAM =
  /opencode\.ai|discord\.(com|gg)|github\.com\/(anomalyco|sst)\/opencode|raw\.githubusercontent\.com\/(anomalyco|sst)\/opencode|registry\.npmjs\.org\/@opencode/

// Что остаётся намеренно, с причиной.
const ALLOWED: Record<string, string> = {
  "packages/cli/src/config/schema.ts": "адрес JSON-схемы конфигурации: формат файла апстрима, своей схемы у нас нет",
  "packages/app/src/shell/layout/helpers.ts": "значок проекта opencode в списке проектов — данные о чужом проекте",
  "packages/app/src/providers/connect/dialog.tsx": "провайдеры апстрима: в Buff Code окно их не показывает (#377)",
  "packages/app/src/providers/credentials/dialog.tsx": "свой провайдер: в Buff Code не предлагается (#377)",
  "packages/app/src/settings/about/about.tsx":
    "страница «About» апстрима: в Buff Code показывается своя (buff/about.tsx)",
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.tsx?$/.test(name)) yield path
  }
}

test("в интерфейсах нет адресов апстрима", () => {
  const found: string[] = []
  for (const dir of SCANNED)
    for (const path of files(join(root, dir))) {
      const file = relative(root, path)
      if (SKIPPED.test(file) || file in ALLOWED) continue
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (UPSTREAM.test(line)) found.push(`${file}:${index + 1}`)
        })
    }
  expect(found).toEqual([])
})

test("«что нового» едет в выпуске и читается из канала обновлений", () => {
  expect(readFileSync(join(root, "buff/package.sh"), "utf8")).toContain(
    'cp "$ROOT/buff/changelog.json" "$OUT/changelog.json"',
  )
  expect(Array.isArray(JSON.parse(readFileSync(join(root, "buff/changelog.json"), "utf8")))).toBe(true)
  expect(BuffLinks.changelog.endsWith("/desktop/buff-code/changelog.json")).toBe(true)
})
