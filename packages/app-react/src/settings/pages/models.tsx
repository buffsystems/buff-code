// Models (#584), ported from the Solid window's settings/models/models.tsx: the models of every
// connected provider, grouped by provider (the well-known ones first), each with a switch for
// whether it shows in the model pickers. Groups fold, remembered per server; a search opens them.

import "../../providers/providers.css"
import { IconButton, Input } from "@buff/ui/react"
import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPersisted } from "../../core/persisted"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useCore } from "../../react/core"
import { useStore } from "../../react/use-store"
import { useProviderCatalog } from "../../providers/catalog/use-catalog"
import { ModelVisibilityGroups } from "../../providers/models/visibility-groups"
import { SettingsBody, SettingsHeader } from "../kit"
import { useSettingsScope } from "../scope"

// Which provider groups are folded, per server, where the Solid window keeps them.
function useCollapsed(scope: string) {
  const storage = usePlatform().storage
  const [cell] = useState(() =>
    createPersisted<{ collapsed: Record<string, boolean> }>({
      storage: storage("opencode.global.dat"),
      key: scope === "local" ? "settings-v2.models.providers" : `${scope}\u0000settings-v2.models.providers`,
      decode: (raw) => readCollapsed(raw),
      initial: { collapsed: {} },
    }),
  )
  const collapsed = useStore(cell.store, (value) => value.collapsed)
  return {
    collapsed,
    set: (provider: string, value: boolean) =>
      cell.set((current) => ({ collapsed: { ...current.collapsed, [provider]: value } })),
  }
}

function readCollapsed(raw: string): { collapsed: Record<string, boolean> } | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null || !("collapsed" in value)) return undefined
    const collapsed = value.collapsed
    if (typeof collapsed !== "object" || collapsed === null) return undefined
    const entries = Object.entries(collapsed).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    )
    return { collapsed: Object.fromEntries(entries) }
  } catch {
    return undefined
  }
}

export function SettingsModels(props: { autofocus: boolean }) {
  const i18n = useI18n()
  const core = useCore()
  const scope = useSettingsScope()
  const catalog = useProviderCatalog(scope.server, scope.directory)
  const folded = useCollapsed(core.scope(scope.server.key))
  const [filter, setFilter] = useState("")
  const field = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!props.autofocus) return
    const frame = requestAnimationFrame(() => field.current?.querySelector("input")?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [props.autofocus])

  return (
    <>
      <SettingsHeader title={i18n.t("settings.models.title")} description={i18n.t("settings.models.description")}>
        <div ref={field} className="settings-tab-search flex items-center gap-1">
          <Input
            type="search"
            className="flex-1"
            value={filter}
            placeholder={i18n.t("dialog.model.search.placeholder")}
            aria-label={i18n.t("dialog.model.search.placeholder")}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
          {filter && (
            <IconButton icon={X} size="xs" aria-label={i18n.t("common.clear")} onClick={() => setFilter("")} />
          )}
        </div>
      </SettingsHeader>
      <SettingsBody className="settings-models">
        <ModelVisibilityGroups
          models={catalog.models}
          ready={catalog.ready}
          filter={filter}
          collapsed={folded.collapsed}
          onCollapse={folded.set}
        />
      </SettingsBody>
    </>
  )
}
