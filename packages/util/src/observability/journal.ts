/**
 * Buff (#538): строки журнала движка для склада. Склад больше не читает файл журнала с общего
 * диска — строки едут в базу движка (`buff_log`, core `buff/journal.ts`) и дальше той же
 * очередью сквозной записи, что и всё остальное. Логгер пишет с первой строки процесса, а база
 * открывается позже, поэтому строки копятся здесь, в общем на процесс накопителе (сборщик может
 * разложить модуль по двум чанкам — отсюда `Symbol.for`), и забираются базой, когда та готова.
 * Накопитель ограничен: при переполнении вытесняются самые старые строки, а их число едет
 * вместе со следующей порцией.
 */

/** Предел накопленного текста: столько живёт в памяти, пока база не забрала строки. */
export const MAX_BYTES = 8 * 1024 * 1024

type Queue = { lines: string[]; bytes: number; dropped: number }

const KEY = Symbol.for("buff.log.journal")
const holder = globalThis as unknown as { [KEY]?: Queue }
const queue = (): Queue => (holder[KEY] ??= { lines: [], bytes: 0, dropped: 0 })

/** Копит только раннер: журнал разработчика остаётся на его машине. */
export function enabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.BUFF_RUNNER)
}

/** Строки отправителя очереди в журнал склада не идут: их доставка порождала бы новые строки. */
export function journaled(message: unknown): boolean {
  const first = Array.isArray(message) ? message[0] : message
  return !(typeof first === "string" && first.startsWith("outbox:"))
}

export function push(line: string, max = MAX_BYTES): void {
  const q = queue()
  q.lines.push(line)
  q.bytes += line.length
  while (q.bytes > max && q.lines.length > 1) {
    q.bytes -= q.lines.shift()!.length
    q.dropped++
  }
}

/** Всё накопленное — забирается целиком, один раз. */
export function take(): { lines: string[]; dropped: number } {
  const q = queue()
  const out = { lines: q.lines, dropped: q.dropped }
  holder[KEY] = { lines: [], bytes: 0, dropped: 0 }
  return out
}

export * as LogJournal from "./journal.js"
