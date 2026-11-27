export * as BuffMemoryNotes from "./buff-memory-notes.js"

/**
 * Заметки памяти (#969): файл MEMORY.md рядом с AGENTS.md — у пользователя (вся учётная запись) и
 * в корне проекта. Инструкции (AGENTS.md) пишет человек; заметки — короткие факты и предпочтения,
 * которые сохраняет агент (`memory_save`) и которые человек видит списком, правит и удаляет.
 * Заметка — пункт списка; её номер, время и чат лежат в комментарии в конце строки, так что файл
 * читается и правится руками. Pure.
 */

export const FILE = "MEMORY.md"

export interface Note {
  id: string
  text: string
  /** Когда сохранена, ISO. */
  at?: string
  /** Из какого чата. */
  chat?: string
}

const LINE = /^\s*[-*]\s+(.*?)\s*(?:<!--\s*(.*?)\s*-->)?\s*$/
const isNote = (line: string) => /^\s*[-*]\s+\S/.test(line)

// Пункт, дописанный руками, получает номер по своему тексту: тот же текст — тот же номер.
function handID(text: string): string {
  let hash = 5381
  for (const sign of text) hash = (Math.imul(hash, 33) ^ sign.codePointAt(0)!) >>> 0
  return `h${hash.toString(36)}`
}

export function parse(file: string): Note[] {
  const seen = new Set<string>()
  return file.split("\n").flatMap((line): Note[] => {
    const found = isNote(line) ? LINE.exec(line) : null
    const text = found?.[1]?.trim()
    if (!text) return []
    const meta = Object.fromEntries(
      (found?.[2] ?? "").split(/\s+/).flatMap((pair) => {
        const at = pair.indexOf(":")
        return at > 0 ? [[pair.slice(0, at), pair.slice(at + 1)] as const] : []
      }),
    )
    let id = meta.id || handID(text)
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    return [{ id, text, ...(meta.at ? { at: meta.at } : {}), ...(meta.chat ? { chat: meta.chat } : {}) }]
  })
}

const line = (note: Note) =>
  `- ${note.text} <!-- id:${note.id}${note.at ? ` at:${note.at}` : ""}${note.chat ? ` chat:${note.chat}` : ""} -->`

/** Файл с этими заметками: то, что в прежнем файле заметкой не было (заголовок, пояснение), остаётся сверху. */
export function serialize(previous: string, notes: readonly Note[]): string {
  const kept = previous.split("\n").filter((item) => !isNote(item))
  while (kept.length && !kept.at(-1)!.trim()) kept.pop()
  const head = kept.join("\n")
  if (!notes.length) return head ? `${head}\n` : ""
  return `${head ? `${head}\n\n` : ""}${notes.map(line).join("\n")}\n`
}

/** Текст заметки одной строкой; `-->` закрыл бы её комментарий. */
export const clean = (text: string) => text.replace(/-->/g, "→").replace(/\s+/g, " ").trim()

export function problem(text: string): string | undefined {
  return clean(text) ? undefined : "Write the note."
}

export function add(notes: readonly Note[], text: string, made: { id: string; at?: string; chat?: string }): Note[] {
  return [...notes, { id: made.id, text: clean(text), ...(made.at ? { at: made.at } : {}), ...(made.chat ? { chat: made.chat } : {}) }]
}

/** undefined — такой заметки нет. */
export function edit(notes: readonly Note[], id: string, text: string): Note[] | undefined {
  if (!notes.some((note) => note.id === id)) return undefined
  return notes.map((note) => (note.id === id ? { ...note, text: clean(text) } : note))
}

export function remove(notes: readonly Note[], id: string): Note[] | undefined {
  return notes.some((note) => note.id === id) ? notes.filter((note) => note.id !== id) : undefined
}

const plain = (notes: readonly Note[]) => notes.map((note) => `- ${note.text}\n`)

/** Больше ли заметок, чем попадает в чат при пределе `max` знаков. */
export const over = (notes: readonly Note[], max: number) => plain(notes).join("").length > max

/** Что получает модель: заметки пунктами, без номеров. Не помещаются — остаются самые свежие. */
export function forModel(notes: readonly Note[], max: number): string {
  const lines = plain(notes)
  let from = lines.length
  for (let size = 0; from > 0 && size + lines[from - 1]!.length <= max; from--) size += lines[from - 1]!.length
  return lines.slice(from).join("")
}
