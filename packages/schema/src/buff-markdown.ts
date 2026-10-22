export * as BuffMarkdown from "./buff-markdown.js"

/**
 * Файл Markdown с шапкой (#445, #446): так хранятся навыки, команды и субагенты. Читаем и
 * переписываем только те записи шапки, которыми управляет интерфейс; всё остальное, что человек
 * написал в шапке руками, остаётся как было.
 */

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/
const withNewline = (text: string) => (text.endsWith("\n") ? text : `${text}\n`)

/** Записи верхнего уровня шапки: ключ и его строки (значение может занимать несколько строк). */
function records(header: string): { key: string | undefined; lines: string[] }[] {
  const found: { key: string | undefined; lines: string[] }[] = []
  for (const line of header.split(/\r?\n/)) {
    const key = /^([A-Za-z0-9_/-]+):/.exec(line)?.[1]
    if (key || found.length === 0) found.push({ key, lines: [line] })
    else found.at(-1)!.lines.push(line)
  }
  return found
}

/** Значение записи шапки: простое, в кавычках или многострочное (`>`, `|`). */
function scalar(lines: readonly string[]): string {
  const first = lines[0].slice(lines[0].indexOf(":") + 1).trim()
  if (/^[>|][+-]?$/.test(first))
    return lines
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(first.startsWith("|") ? "\n" : " ")
  if (first.startsWith('"')) {
    try {
      return String(JSON.parse(first))
    } catch {
      return first.slice(1, -1)
    }
  }
  return first.startsWith("'") && first.endsWith("'") ? first.slice(1, -1).replaceAll("''", "'") : first
}

export interface Parts<Key extends string> {
  readonly values: Record<Key, string | undefined>
  readonly body: string
}

export function parts<Key extends string>(text: string, keys: readonly Key[]): Parts<Key> {
  const header = HEADER.exec(text)
  const found = header ? records(header[1]) : []
  const value = (key: string) => {
    const record = found.find((item) => item.key === key)
    return record ? scalar(record.lines) : undefined
  }
  return {
    values: Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<Key, string | undefined>,
    body: header ? text.slice(header[0].length).replace(/^\r?\n/, "") : text,
  }
}

/** Признаки и числа пишутся как есть, остальное — в кавычках: так значение не прочтут иначе. */
const written = (value: string) => (/^(true|false|\d+)$/.test(value) ? value : JSON.stringify(value))

/**
 * Тот же файл с новыми значениями и текстом. Управляемые записи встают первыми, в заданном
 * порядке; пустое значение убирает запись; прочие записи шапки остаются.
 */
export function edited(text: string, values: readonly (readonly [string, string | undefined])[], body: string): string {
  const header = HEADER.exec(text)
  const managed = new Set(values.map(([key]) => key))
  const kept = header
    ? records(header[1])
        .filter((record) => !record.key || !managed.has(record.key))
        .flatMap((record) => record.lines)
        .filter((line, index, lines) => line.trim() || index < lines.length - 1)
    : []
  const lines = [
    ...values.flatMap(([key, value]) => (value?.trim() ? [`${key}: ${written(value.trim())}`] : [])),
    ...kept,
  ]
  return lines.length ? `---\n${lines.join("\n")}\n---\n\n${withNewline(body)}` : withNewline(body)
}
