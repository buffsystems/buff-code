import type { LocationRef, OpenCodeClient } from "@opencode/client/promise"
import type { Store } from "../store"
import type { SyncGate } from "./sync-gate"
import type { DataState } from "./state"

/** What the read modules of one server's data share. */
export type DataContext = {
  readonly api: () => OpenCodeClient
  readonly store: Store<DataState>
  readonly gate: SyncGate
  /** Run an event-driven read; failures go to onError, and nothing runs while disconnected. */
  readonly refresh: (load: () => Promise<unknown>) => void
  /** Run `load` once a burst of same-key events goes quiet, so N events cost one refetch. */
  readonly settle: (key: string, load: () => Promise<unknown>) => void
  readonly initialMessageLimit: () => number
}

export const defaultLocation = (context: DataContext) => context.store.get().defaultLocation

export function locationQuery(ref: LocationRef) {
  return { directory: ref.directory }
}
