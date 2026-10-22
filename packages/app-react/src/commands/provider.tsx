import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { useOptionalPlatform } from "../platform/context"
import { useStore } from "../react/use-store"
import { createCommandCatalog } from "./catalog"
import { takeEarlyKeys } from "./early-keys"
import { createStore, type Store } from "../core/store"
import { CommandPalette, type PaletteContext } from "./palette"
import { createCommandRegistry, PALETTE_ID, type CommandOption, type CommandRegistry } from "./registry"

const CommandContext = createContext<CommandRegistry | undefined>(undefined)
const CatalogContext = createContext<ReturnType<typeof createCommandCatalog> | undefined>(undefined)
const PaletteContextStore = createContext<Store<PaletteContext | undefined> | undefined>(undefined)

/** Commands and keybinds of the window; the palette is the first command. */
export function CommandProvider(props: { keybindOverride?: (id: string) => string | undefined; children?: ReactNode }) {
  const dialog = useDialog()
  const i18n = useI18n()
  const [registry] = useState(() =>
    createCommandRegistry({
      blocked: dialog.active,
      suggestedCategory: () => i18n.t("command.category.suggested"),
      keybindOverride: props.keybindOverride,
    }),
  )

  const [palette] = useState(() => createStore<PaletteContext | undefined>(undefined))
  const platform = useOptionalPlatform()
  const [catalog] = useState(() => createCommandCatalog(platform?.storage("opencode.global.dat"), registry))
  useEffect(() => catalog.start(), [catalog])

  useEffect(() => {
    document.addEventListener("keydown", registry.handleKeyDown, { capture: true })
    return () => document.removeEventListener("keydown", registry.handleKeyDown, { capture: true })
  }, [registry])

  useEffect(
    () =>
      registry.register("command.palette", () => [
        {
          id: PALETTE_ID,
          title: i18n.t("command.palette"),
          hidden: true,
          onSelect: () =>
            void dialog.show((close) => <CommandPalette registry={registry} context={palette.get()} onClose={close} />),
        },
      ]),
    [registry, dialog, i18n, palette],
  )

  // After the screens below registered their commands: shortcuts pressed while mounting.
  useEffect(() => takeEarlyKeys().forEach(registry.handleKeyDown), [registry])

  return (
    <CommandContext value={registry}>
      <CatalogContext value={catalog}>
        <PaletteContextStore value={palette}>{props.children}</PaletteContextStore>
      </CatalogContext>
    </CommandContext>
  )
}

/** Every visible command the window has seen, by id (the shortcuts settings list them all). */
export function useCommandCatalog() {
  const catalog = use(CatalogContext)
  if (!catalog) throw new Error("useCommandCatalog must be used inside CommandProvider")
  return useStore(catalog.store, (value) => value)
}

export function useCommands() {
  const registry = use(CommandContext)
  if (!registry) throw new Error("useCommands must be used inside CommandProvider")
  return registry
}

/**
 * Register a screen's commands while it is mounted. The registry reads lists when a key is pressed
 * or the palette opens, so the latest render's list is always the one offered.
 */
export function useCommandRegistration(key: string, list: () => CommandOption[]) {
  const registry = useCommands()
  const latest = useRef(list)
  latest.current = list
  useEffect(() => registry.register(key, () => latest.current()), [registry, key])
}

/**
 * What the palette searches and opens where the window is now (files of the shown session, the
 * server's sessions); the latest mounted provider wins until it unmounts.
 */
export function usePaletteContext(context: PaletteContext) {
  const store = use(PaletteContextStore)
  useEffect(() => {
    if (!store) return
    store.set(() => context)
    return () => store.set((current) => (current === context ? undefined : current))
  }, [store, context])
}
