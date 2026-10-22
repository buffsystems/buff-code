// Сторож переводов (#472). Строки интерфейса пишутся по-английски и идут через перевод;
// русский текст живёт только в каталогах. Пока перевод не закончен, файлы с русскими строками
// перечислены в buff/i18n-pending.json вместе с их числом — оно может только убывать
// (пересчёт: bun buff/i18n-pending.ts).
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { files, root, SOURCES, untranslated } from "./i18n-scan"

const pending: Record<string, number> = JSON.parse(readFileSync(join(root, "buff/i18n-pending.json"), "utf8"))
const found = untranslated()

test("русские строки интерфейса — только в каталогах переводов (новых не прибавляется)", () => {
  const extra = Object.entries(found)
    .filter(([path, count]) => count > (pending[path] ?? 0))
    .map(([path, count]) => `${path}: ${count} (было ${pending[path] ?? 0})`)
  expect(extra).toEqual([])
})

test("список «ещё не переведено» не отстаёт: переведённое из него убрано", () => {
  const stale = Object.entries(pending)
    .filter(([path, count]) => (found[path] ?? 0) < count)
    .map(([path, count]) => `${path}: ${found[path] ?? 0} (в списке ${count})`)
  expect(stale).toEqual([])
})

test("каждая строка, переданная в перевод, есть в русском каталоге", async () => {
  const { RU } = await import("../../packages/schema/src/buff-i18n/ru.ts")
  const CALLS = [
    /(?<![.\w])t\(\s*"((?:[^"\\]|\\.)+)"/g,
    /BuffI18n\.t\(\s*[^,()]+,\s*"((?:[^"\\]|\\.)+)"/g,
    /(?<![.\w])n\(\s*[^,()]+,\s*"((?:[^"\\]|\\.)+)"/g,
    /BuffI18n\.n\(\s*[^,()]+,\s*[^,()]+,\s*"((?:[^"\\]|\\.)+)"/g,
    /buffNativeText\(\s*"((?:[^"\\]|\\.)+)"/g,
    /BuffLocale\.t\(\s*"((?:[^"\\]|\\.)+)"/g,
  ]
  const missing = SOURCES.flatMap((dir) => files(join(root, "packages", dir))).flatMap((path) => {
    const source = readFileSync(path, "utf8")
    return CALLS.flatMap((re) => [...source.matchAll(re)].map((match) => match[1]!))
      // «ключ.с.точками» — ключ словаря апстрима, а не строка Buff.
      .filter((text) => !/^[\w-]+(\.[\w-]+)+$/.test(text) && !(text in RU))
      .map((text) => `${relative(root, path)}: «${text}»`)
  })
  expect(missing).toEqual([])
})
