import { createResource, onCleanup, onMount } from "solid-js"
import { BuffSessionMarks as Marks } from "@opencode/schema/buff-session-marks"
import { BuffSide } from "@opencode/schema/buff-side"
import { useClient } from "../../context/client"

/**
 * Отметки сессий в консоли (#452): закрепление и архив — те же, что в окне (хранит ядро).
 * Без службы Buff отметок нет: список ведёт себя как раньше.
 */
export function useSessionMarks() {
  const client = useClient()
  const rpc = client.api.rpc(Marks.Rpc)
  const side = client.api.rpc(BuffSide.Rpc)
  const [state, { mutate, refetch }] = createResource(() => rpc.get(undefined).catch(() => Marks.EMPTY), {
    initialValue: Marks.EMPTY,
  })
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) void refetch()
    })().catch(() => undefined)
    // Новый побочный диалог (#470) уходит из списка сразу.
    void (async () => {
      for await (const _ of side.events.subscribe("opened", { signal: stop.signal })) void refetch()
    })().catch(() => undefined)
  })
  const current = () => state.latest ?? Marks.EMPTY
  return {
    pinned: () => current().pinned,
    isPinned: (sessionID: string) => current().pinned.includes(sessionID),
    isArchived: (sessionID: string) => current().archived.includes(sessionID),
    /** Побочный диалог (#470): живёт во вкладке своей сессии, в списке его нет. */
    isSide: (sessionID: string) => Marks.isSide(current(), sessionID),
    change: (input: Marks.Change) => rpc.change(input).then(mutate),
  }
}
