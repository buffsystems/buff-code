// Buff (#639): ключ машины и сопряжённые телефоны — в каталоге конфигурации Buff Code, только
// владельцу (каталог 0700, файлы 0600, запись через временный файл и rename). Ключ создаётся
// один раз: по нему шлюз и телефоны узнают машину.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { b64u, fromB64u, generateIdentity, identityFromSeed, type DeviceRecord, type Identity } from "@buff/mobile-protocol"

export interface MobileStore {
  identity(): Promise<Identity>
  devices(): Promise<DeviceRecord[]>
  device(id: string): Promise<DeviceRecord | null>
  saveDevice(record: DeviceRecord): Promise<void>
  /** Телефон отключён: запись остаётся с отметкой времени — повторно он входит только новым сопряжением. */
  revoke(device: string, at: number): Promise<DeviceRecord | null>
  rename(device: string, display: string): Promise<void>
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

/** Хранилище в каталоге `dir` (обычно `<config>/mobile`). */
export function fileStore(dir: string): MobileStore {
  const keyFile = path.join(dir, "identity.json")
  const devicesFile = path.join(dir, "devices.json")
  let identity: Promise<Identity> | null = null
  const devices = async () => (await read<DeviceRecord[]>(devicesFile)) ?? []
  const put = (list: DeviceRecord[]) => write(devicesFile, list)
  return {
    identity() {
      identity ??= (async () => {
        const saved = await read<{ seed: string }>(keyFile)
        if (saved?.seed) return identityFromSeed(fromB64u(saved.seed))
        const fresh = generateIdentity()
        await write(keyFile, { seed: b64u(fresh.seed) })
        return fresh.identity
      })()
      return identity
    },
    devices,
    async device(id) {
      return (await devices()).find((d) => d.device === id) ?? null
    },
    async saveDevice(record) {
      await put([...(await devices()).filter((d) => d.device !== record.device), record])
    },
    async revoke(device, at) {
      const list = await devices()
      const found = list.find((d) => d.device === device && !d.revoked)
      if (!found) return null
      await put(list.map((d) => (d === found ? { ...d, revoked: at } : d)))
      return found
    },
    async rename(device, display) {
      await put((await devices()).map((d) => (d.device === device ? { ...d, display } : d)))
    },
  }
}
