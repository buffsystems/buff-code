import { createMemo, createResource, onCleanup, onMount, type Accessor } from "solid-js"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { useServerSDK } from "@/runtime/server/client"
import { useBuffText } from "@/buff/i18n"

/**
 * Навыки каталога, как их знает ядро (#445): список с происхождением и подключённые источники.
 * Один источник и для экрана настроек, и для подписей в подсказках поля ввода; сам следит за
 * изменениями.
 */
export function createSkillState(directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const rpc = sdk.api.rpc(BuffSkill.Rpc)
  const at = () => {
    const value = directory()
    return value ? { location: { directory: value } } : undefined
  }
  const empty = { skills: [] as BuffSkill.Entry[], sources: [] as BuffSkill.Source[] }
  const [state, { refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? (directory() ?? "") : undefined),
    () => rpc.list(undefined, at()).catch(() => empty),
    { initialValue: empty },
  )
  // Ядро перечитывает файлы навыков с небольшой задержкой — список дочитывается следом.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const settle = () => {
    void refetch()
    const timer = setTimeout(() => {
      timers.delete(timer)
      void refetch()
    }, 1500)
    timers.add(timer)
  }
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => {
      stop.abort()
      timers.forEach(clearTimeout)
    })
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) settle()
    })().catch(() => undefined)
  })
  return {
    rpc,
    at,
    settle,
    skills: () => state.latest?.skills ?? [],
    sources: () => state.latest?.sources ?? [],
  }
}

/** Подпись навыка в подсказках поля ввода — с пометкой, откуда он. */
export function useSkillNotes(directory: Accessor<string | undefined>) {
  const state = createSkillState(directory)
  const { t } = useBuffText()
  const origins = createMemo(() => new Map(state.skills().map((skill) => [skill.id, skill.scope])))
  return (id: string, description: string | undefined) => BuffSkill.suggestionNote(origins().get(id), description, t)
}
