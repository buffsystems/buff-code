// The commands the window has seen (#584), the Solid window's persisted command catalog
// (opencode.global.dat:command.catalog.v1): every visible command registered on any screen, with
// its title and default keybind, so the shortcuts settings list commands of screens not open now.

import { Option, Schema } from "effect"
import { createPersisted } from "../core/persisted"
import type { PlatformStorage } from "../platform/platform"
import type { CommandOption, CommandRegistry } from "./registry"

const CatalogItem = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  keybind: Schema.optional(Schema.String),
  slash: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
})

export type CommandCatalogItem = typeof CatalogItem.Type
export type CommandCatalog = Record<string, CommandCatalogItem>

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, CatalogItem)))

const SUGGESTED_PREFIX = "suggested."

/**
 * A catalog entry of an option, or nothing for options the catalog does not keep. A hidden command
 * (closing settings shares the id and the keys) does not rename a known one, but enters when new so
 * its keys stay editable in settings (the Solid window's writesCatalog).
 */
export function catalogEntry(option: CommandOption, known: boolean): CommandCatalogItem | undefined {
  if (!option.title || option.id.startsWith(SUGGESTED_PREFIX)) return undefined
  if (option.hidden && known) return undefined
  return {
    title: option.title,
    description: option.description,
    category: option.category,
    keybind: option.keybind,
    slash: option.slash,
  }
}

const same = (a: CommandCatalogItem | undefined, b: CommandCatalogItem) =>
  !!a &&
  a.title === b.title &&
  a.description === b.description &&
  a.category === b.category &&
  a.keybind === b.keybind &&
  a.slash === b.slash

/** The catalog; `start` records what the registry offers as screens register and returns its stop. */
export function createCommandCatalog(
  storage: PlatformStorage | undefined,
  registry: Pick<CommandRegistry, "changes" | "registered">,
) {
  const cell = createPersisted<CommandCatalog>({
    // Without a platform (a component mounted alone) the catalog lives in memory.
    storage: storage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    key: "command.catalog.v1",
    decode: (raw) => Option.getOrUndefined(decode(raw)),
    initial: {},
  })
  const record = () =>
    cell.ready.then(() => {
      const current = cell.store.get()
      // In order, as the Solid window writes them: an entry made here is known to the next option.
      const next = registry.registered().reduce<CommandCatalog>((catalog, option) => {
        const entry = catalogEntry(option, option.id in catalog)
        return entry && !same(catalog[option.id], entry) ? { ...catalog, [option.id]: entry } : catalog
      }, current)
      if (next !== current) cell.set((catalog) => ({ ...catalog, ...next }))
    })
  return {
    store: cell.store,
    start() {
      void record()
      return registry.changes.subscribe(() => void record())
    },
  }
}
