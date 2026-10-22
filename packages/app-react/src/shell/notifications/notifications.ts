// What finished while nobody looked (#584): a server's turn-complete and error notifications,
// persisted where the Solid window keeps them, with what each session and project has unseen.

import { Option, Schema } from "effect"
import { createPersisted } from "../../core/persisted"
import type { PlatformStorage } from "../../platform/platform"

export type Notification = {
  type: "turn-complete" | "error"
  session?: string
  directory?: string
  time: number
  viewed: boolean
  error?: unknown
  metadata?: unknown
}

const NotificationSchema = Schema.Struct({
  type: Schema.Literals(["turn-complete", "error"]),
  session: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  time: Schema.Finite,
  viewed: Schema.Boolean,
  error: Schema.optional(Schema.Unknown),
  metadata: Schema.optional(Schema.Unknown),
})
const StoreSchema = Schema.Struct({ list: Schema.Array(NotificationSchema) })
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(StoreSchema))

const MAX = 500
const TTL = 1000 * 60 * 60 * 24 * 30

export function pruneNotifications(list: readonly Notification[], now: number) {
  return list.filter((item) => item.time >= now - TTL).slice(-MAX)
}

/** The Solid window's key: the bare key for the local server, the scope-prefixed one otherwise. */
export const notificationKey = (scope: string) => (scope === "local" ? "notification" : `${scope}\u0000notification`)

export function createNotifications(input: { storage: PlatformStorage; scope: string; now?: () => number }) {
  const now = input.now ?? Date.now
  const cell = createPersisted<{ list: readonly Notification[] }>({
    storage: input.storage,
    key: notificationKey(input.scope),
    decode: (raw) => {
      const value = Option.getOrUndefined(decode(raw))
      return value ? { list: pruneNotifications(value.list, now()) } : undefined
    },
    initial: { list: [] },
  })
  const unseen = (match: (item: Notification) => boolean) =>
    cell.store.get().list.filter((item) => !item.viewed && match(item))
  const mark = (match: (item: Notification) => boolean) =>
    cell.set((state) =>
      state.list.some((item) => !item.viewed && match(item))
        ? { list: state.list.map((item) => (!item.viewed && match(item) ? { ...item, viewed: true } : item)) }
        : state,
    )
  return {
    store: cell.store,
    ready: cell.ready,
    append: (notification: Notification) =>
      cell.set((state) => ({ list: pruneNotifications([...state.list, notification], now()) })),
    session: {
      unseenCount: (session: string) => unseen((item) => item.session === session).length,
      unseenHasError: (session: string) =>
        unseen((item) => item.session === session).some((item) => item.type === "error"),
      markViewed: (session: string) => mark((item) => item.session === session),
    },
    project: {
      unseenCount: (directory: string) => unseen((item) => item.directory === directory).length,
      markViewed: (directory: string) => mark((item) => item.directory === directory),
    },
  }
}

export type Notifications = ReturnType<typeof createNotifications>
