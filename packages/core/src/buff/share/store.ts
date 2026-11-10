// Buff (#816, эпик #769): записи публичных ссылок машины — в каталоге конфигурации Buff Code,
// только владельцу (как ключ машины и телефоны, mobile/store.ts). Содержимое диалога здесь не
// хранится: запись знает лишь, ЧТО показывать (сессия, выбранные сообщения) и на каких условиях
// (пароль, срок, инструменты). Пароль — только хэш (scrypt) и соль.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export interface ShareRecord {
  id: string
  session: string
  /** Выбранные сообщения (по id) — ссылка на часть диалога; пусто — весь диалог. */
  messages: string[]
  title: string
  pass: { salt: string; hash: string } | null
  /** Эпоха, мс; null — бессрочно. */
  expiresAt: number | null
  /** Показывать ли вызовы инструментов ИИ и их результаты. */
  tools: boolean
  /** Трансляция: страница следует за сессией (#823). */
  live: boolean
  enabled: boolean
  /** Эпоха, мс. */
  created: number
  /** Шлюз знает о ссылке (публикация подтверждена); иначе её ещё надо объявить. */
  published: boolean
  /** Источник удалён или ссылка снята: ждёт отзыва на шлюзе, потом исчезает. */
  gone?: true
}

export interface ShareStore {
  list(): Promise<ShareRecord[]>
  get(id: string): Promise<ShareRecord | null>
  save(record: ShareRecord): Promise<void>
  remove(id: string): Promise<void>
}

const write = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  await rename(temp, file)
}

const read = async <T>(file: string): Promise<T | null> =>
  readFile(file, "utf8").then(
    (text) => JSON.parse(text) as T,
    () => null,
  )

/** Хранилище в каталоге `dir` (обычно `<config>/share`). */
export function fileShareStore(dir: string): ShareStore {
  const file = path.join(dir, "links.json")
  const list = async () => (await read<ShareRecord[]>(file)) ?? []
  const put = (records: ShareRecord[]) => write(file, records)
  return {
    list,
    async get(id) {
      return (await list()).find((r) => r.id === id) ?? null
    },
    async save(record) {
      await put([...(await list()).filter((r) => r.id !== record.id), record])
    },
    async remove(id) {
      await put((await list()).filter((r) => r.id !== id))
    },
  }
}

/** Хранилище в памяти — для тестов и как образец контракта. */
export function memShareStore(): ShareStore {
  const records = new Map<string, ShareRecord>()
  return {
    async list() {
      return [...records.values()]
    },
    async get(id) {
      return records.get(id) ?? null
    },
    async save(record) {
      records.set(record.id, record)
    },
    async remove(id) {
      records.delete(id)
    },
  }
}

const KEY_BYTES = 32

export function hashPassword(pass: string): { salt: string; hash: string } {
  const salt = randomBytes(16)
  return { salt: salt.toString("base64url"), hash: scryptSync(pass.normalize(), salt, KEY_BYTES).toString("base64url") }
}

export function verifyPassword(stored: { salt: string; hash: string }, pass: string): boolean {
  const got = scryptSync(pass.normalize(), Buffer.from(stored.salt, "base64url"), KEY_BYTES)
  const want = Buffer.from(stored.hash, "base64url")
  return got.length === want.length && timingSafeEqual(got, want)
}
