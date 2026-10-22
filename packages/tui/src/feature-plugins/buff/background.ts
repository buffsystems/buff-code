import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { LocationRef } from "@opencode/client"
import { BuffBackground } from "@opencode/schema/buff-background"
import type { useClient } from "../../context/client"
import { t } from "./locale"

/**
 * Фоновая работа в консоли (#456): время работы во вкладках Subagents/Shell и в счётчике под
 * полем ввода, остановка через ядро (`buff.background.stop`) — остановленная человеком работа
 * модель не будит. Слова и время — общие с окном (`BuffBackground`).
 */

/** Часы для времени работы: тикают раз в секунду, пока компонент на экране. */
export function useNow(): Accessor<number> {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))
  return now
}

/** Остановить фоновую команду или агента; `false` — уже завершилось. */
export function stopBackground(client: ReturnType<typeof useClient>, id: string, location?: LocationRef) {
  return client.api
    .rpc(BuffBackground.Rpc)
    .stop({ id }, location ? { location } : undefined)
    .then((result) => result.stopped)
}

/** Счётчик «2 shells» — с временем самой давней: «2 shells · 1 мин 05 с». */
export function countWithTime(count: string | undefined, starts: readonly number[], now: number) {
  if (!count || starts.length === 0) return count
  return `${count} · ${BuffBackground.elapsed(now - Math.min(...starts), t)}`
}
