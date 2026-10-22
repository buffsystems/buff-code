// Пересчёт списка «ещё не переведено» (#472): число русских строк по файлам — только вниз.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { root, untranslated } from "./test/i18n-scan"

const path = join(root, "buff/i18n-pending.json")
const before: Record<string, number> = JSON.parse(readFileSync(path, "utf8"))
const now = untranslated()
const grown = Object.entries(now).filter(([file, count]) => count > (before[file] ?? 0))
if (grown.length) {
  console.error("Прибавились русские строки — переведите их, список не растёт:")
  for (const [file, count] of grown) console.error(`  ${file}: ${count} (было ${before[file] ?? 0})`)
  process.exit(1)
}
writeFileSync(path, JSON.stringify(now, null, 2) + "\n")
const total = (list: Record<string, number>) => Object.values(list).reduce((a, b) => a + b, 0)
console.log(`осталось: ${Object.keys(now).length} файлов, ${total(now)} строк (было ${total(before)})`)
