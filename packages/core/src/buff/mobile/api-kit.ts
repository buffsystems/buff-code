// Buff (#969): общее для групп команд мобильного API — файл `api.ts` вырос, новые команды лежат
// по группам (`api-*.ts`), а то, что им нужно от соседей, приходит одним набором.
import type { DeviceRecord } from "@buff/mobile-protocol"
import type { Call } from "./api.js"
import { phoneRefusal } from "./refusal.js"

export type Op = (args: Record<string, unknown>, record: DeviceRecord) => Promise<unknown>
export type Ops = Record<string, Op>

export interface ProjectRow {
  id: string
  canonical: string
  name?: string
  icon?: { color?: string }
  time: { updated: number }
}

/** Пределы машины для клиента: на облачной их задаёт оператор (BUFF_CLOUD_LIMITS). */
export interface MachineLimits {
  uploadMaxBytes: number
  memoryMaxChars: number
  mcpServersMax: number
}

/** Что машина знает о себе: домашний каталог, облачная ли она и её пределы. */
export interface Machine {
  home: string
  cloud: boolean
  limits: MachineLimits
}

export interface Kit {
  call: Call
  machine: Machine
  /** Дом машины как проект движка: чаты вне проектов идут в нём. */
  home(): Promise<{ project: string; directory: string }>
  projects(): Promise<ProjectRow[]>
  /** Проект из списка машины; неизвестный — отказ. */
  project(id: string): Promise<ProjectRow>
  directoryOf(session: string): Promise<string>
  /** Загруженный частями файл (`attachment_upload`) — целиком и один раз; не догрузился — отказ. */
  takeUpload(id: string): { name: string; mime: string; bytes: Buffer }
}

export const data = <T>(reply: unknown): T => (reply as { data: T }).data

export const str = (args: Record<string, unknown>, key: string): string => {
  const v = args[key]
  if (typeof v !== "string" || !v.trim()) throw phoneRefusal("The field {key} is required", { key })
  return v.trim()
}

/** Вызов RPC Buff в каталоге: ответ — его `output`. */
export const rpc = async <T>(kit: Kit, directory: string, id: string, method: string, input?: unknown): Promise<T> => {
  const reply = (await kit.call("POST", `/api/rpc/${id}/${method}`, {
    query: { "location[directory]": directory },
    body: input === undefined ? {} : { input },
  })) as { output?: T }
  return reply?.output as T
}
