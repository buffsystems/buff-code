// Following a Buff RPC's change events while a settings page is open (#584).

import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import type { Server } from "../../core/servers"
import { useConnection } from "../../react/core"

/** Call `onChange` on every event `subscribe` yields while `enabled`; the stream stops on unmount. */
export function useRpcChanged(
  enabled: boolean,
  subscribe: (signal: AbortSignal) => AsyncIterable<unknown>,
  onChange: () => void,
) {
  const latest = useRef({ subscribe, onChange })
  latest.current = { subscribe, onChange }
  useEffect(() => {
    if (!enabled) return
    const stop = new AbortController()
    void (async () => {
      for await (const _ of latest.current.subscribe(stop.signal)) latest.current.onChange()
    })().catch(() => undefined)
    return () => stop.abort()
  }, [enabled])
}

/**
 * A Buff settings list read through its RPC (#444–#446): loaded while the server is connected,
 * read again on the RPC's change events and after each change here (`settle`, with the extra
 * reads `delays` asks for while the server settles). A failed read shows `problem` — a failure
 * is not «empty».
 */
export function useBuffList<Value>(input: {
  server: Server
  name: string
  directory?: string
  empty: Value
  load: () => Promise<Value>
  subscribe: (signal: AbortSignal) => AsyncIterable<unknown>
  /** The words of a failed read; without them a failure reads as the empty list. */
  failure?: string
  delays?: readonly number[]
}) {
  const client = useQueryClient()
  const connected = useConnection(input.server).status === "connected"
  const key = ["buff-settings", input.name, input.server.key, input.directory ?? ""]
  const query = useQuery({
    queryKey: key,
    enabled: connected,
    retry: false,
    queryFn: () => (input.failure === undefined ? input.load().catch(() => input.empty) : input.load()),
  })
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const settle = () => {
    void client.invalidateQueries({ queryKey: key })
    ;(input.delays ?? []).forEach((delay) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        void client.invalidateQueries({ queryKey: key })
      }, delay)
      timers.current.add(timer)
    })
  }
  useRpcChanged(connected, input.subscribe, settle)
  const problem =
    query.isError && input.failure !== undefined ? formatServerError(query.error, undefined, input.failure) : undefined
  return { value: query.data ?? input.empty, problem, settle }
}

/** The location argument of a Buff RPC call in a directory. */
export const at = (directory: string | undefined) => (directory ? { location: { directory } } : undefined)
