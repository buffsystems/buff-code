import { BuffContext } from "@opencode/schema/buff-context"
import { createResource, type Accessor } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"

/**
 * Каталог, по которому настройки показывают подключение и модели (#466). Модели Buff есть там,
 * где выбран рабочий контекст, а настройки сервера открыты в его домашнем каталоге — без
 * этого после успешного входа «Providers» и «Models» пусты. Настройки проекта смотрят в сам
 * проект; настройки сервера — туда, где контекст выбирали последним.
 */
export function settingsDirectory(explicit: string | undefined, last: string | null | undefined): string | undefined {
  return explicit ?? last ?? undefined
}

/** Читается при каждом открытии настроек: выбор мог смениться, пока они были закрыты. */
export function useBuffSettingsDirectory(explicit: Accessor<string | undefined>): Accessor<string | undefined> {
  const sdk = useServerSDK()
  const [last] = createResource(
    () => sdk.connection.status() === "connected",
    (connected) =>
      connected
        ? sdk.api
            .rpc(BuffContext.Rpc)
            .lastDirectory()
            .catch(() => null)
        : null,
  )
  return () => settingsDirectory(explicit(), last())
}
