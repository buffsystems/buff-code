// A persisted document of the composer (#584): a draft prompt or the prompt history, stored where
// the Solid window keeps it so both windows share drafts — in the platform's draft store (IndexedDB
// on the web, the main process on desktop) under `${storage}:${key}`, or in a storage namespace
// when there is no draft store. Writes are batched into one save per 100 ms window, as the Solid
// persistStore does, so typing does not encode the document on every keystroke.

import { Persistence } from "@opencode/app/react-reuse/persistence-schema"
import type { DraftStore } from "@opencode/app/react-reuse/drafts"
import { Option, Schema } from "effect"
import { createStore } from "../../../core/store"
import { DEFAULT_STORAGE, type PlatformStorage } from "../../../platform/platform"

export const saveDelay = 100

export type DocumentTarget = {
  /** The storage namespace; the default namespace when absent. */
  storage?: string
  key: string
  /** Older namespaces of the same document (workspace paths spelled another way). */
  aliases?: string[]
  /** A pre-namespace key in the default namespace. */
  previousKey?: string
}

export type DocumentHost = {
  storage(name: string): PlatformStorage
  draftStore?: DraftStore
}

const pending = new Set<() => void>()

/** Save every document with unsaved changes now (the page is hiding). */
export function flushDocuments() {
  for (const save of [...pending]) save()
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDocuments()
  })
  window.addEventListener("pagehide", flushDocuments)
}

export function createPersistedDocument<S extends Schema.ConstraintCodec<object, unknown>>(input: {
  host: DocumentHost
  target: DocumentTarget
  schema: S
  initial: S["Type"]
  delay?: number
}) {
  const initialized = Persistence.withInitial(input.schema, input.initial)
  const json = Schema.fromJsonString(initialized)
  const decode = Schema.decodeUnknownOption(json)
  const serialize = Schema.encodeSync(json)
  const encode = Schema.encodeSync(initialized)
  const normalize = (raw: string) => {
    const value = decode(raw)
    return Option.isSome(value) ? value.value : undefined
  }
  const store = createStore<S["Type"]>(Schema.decodeUnknownSync(Schema.toType(initialized))(input.initial))
  const namespace = input.host.storage(input.target.storage ?? DEFAULT_STORAGE)
  const draft = input.host.draftStore
  const name = `${input.target.storage ?? "default"}:${input.target.key}`
  const state = { touched: false, dirty: false, last: undefined as string | undefined }
  const loaded = createStore(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const write = (value: S["Type"], serialized: string) => {
    if (draft) {
      void draft
        .setDocument(name, encode(value))
        .catch((error: unknown) => console.error(`[composer] draft write failed for ${name}`, error))
      return
    }
    void namespace.setItem(input.target.key, serialized)
  }

  const save = () => {
    clearTimeout(timer)
    timer = undefined
    pending.delete(save)
    if (!state.dirty) return
    state.dirty = false
    const serialized = serialize(store.get())
    if (serialized === state.last) return
    state.last = serialized
    write(store.get(), serialized)
  }

  const sources = () =>
    [
      ...(draft ? [{ storage: namespace, key: input.target.key }] : []),
      ...(input.target.aliases ?? []).map((alias) => ({ storage: input.host.storage(alias), key: input.target.key })),
      ...(input.target.previousKey
        ? [{ storage: input.host.storage(DEFAULT_STORAGE), key: input.target.previousKey }]
        : []),
    ] satisfies { storage: PlatformStorage; key: string }[]

  // A document left under an older key moves to the current one the first time it is read.
  const relocate = async () => {
    for (const source of sources()) {
      const raw = await source.storage.getItem(source.key)
      if (raw === null) continue
      const value = normalize(raw)
      await source.storage.removeItem(source.key)
      if (value === undefined) continue
      const serialized = serialize(value)
      write(value, serialized)
      return { value, serialized }
    }
  }

  const load = async () => {
    const raw = draft ? await draft.getItem(name) : await namespace.getItem(input.target.key)
    const value = raw === null ? undefined : normalize(raw)
    if (value !== undefined) return { value, serialized: serialize(value) }
    return relocate()
  }

  const ready = load()
    .then((found) => {
      // A value the person already changed is newer than whatever storage held.
      if (!found || state.touched) return
      state.last = found.serialized
      store.set(() => found.value)
    })
    .catch(() => undefined)
    .finally(() => loaded.set(() => true))

  return {
    store,
    ready,
    isReady: () => loaded.get(),
    /** Becomes true once storage was read; components subscribe to it. */
    loaded,
    set(update: (value: S["Type"]) => S["Type"]) {
      const before = store.get()
      store.set(update)
      if (store.get() === before) return
      state.touched = true
      state.dirty = true
      pending.add(save)
      timer ??= setTimeout(save, input.delay ?? saveDelay)
    },
    flush: save,
  }
}

export type PersistedDocument<Value> = {
  store: ReturnType<typeof createStore<Value>>
  ready: Promise<void>
  isReady(): boolean
  loaded: ReturnType<typeof createStore<boolean>>
  set(update: (value: Value) => Value): void
  flush(): void
}
