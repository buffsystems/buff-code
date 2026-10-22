// Which models show in the pickers (#584): the models of the connected providers in folding
// provider groups with a switch per model (and, in the Manage dialog, per provider). Shared by the
// Models settings page and the «Manage models» dialog, as the Solid window's two copies were.

import "../providers.css"
import { Switch } from "@buff/ui/react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useMemo } from "react"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useStore } from "../../react/use-store"
import { SettingsList, SettingsRow, SettingSwitch } from "../../settings/kit"
import { ProviderIcon } from "../provider-icon"
import { groupModels, latestModels, modelKey, modelVisible, type CatalogModel } from "./catalog"
import { modelPreferences } from "./preferences"

export function ModelVisibilityGroups(props: {
  models: CatalogModel[]
  ready: boolean
  filter: string
  collapsed: Record<string, boolean>
  onCollapse: (provider: string, collapsed: boolean) => void
  /** A switch for the whole provider beside its group's title. */
  providerSwitch?: boolean
}) {
  const i18n = useI18n()
  const prefs = modelPreferences(usePlatform().storage)
  const choices = useStore(prefs.store, (state) => state.user)
  const groups = useMemo(() => groupModels(props.models, props.filter), [props.models, props.filter])
  const latest = useMemo(() => latestModels(props.models), [props.models])
  const visible = (model: CatalogModel) =>
    modelVisible(
      model,
      choices.find((item) => item.providerID === model.provider.id && item.modelID === model.id)?.visibility,
      latest,
    )
  const searching = props.filter.length > 0

  if (!props.ready)
    return (
      <div className="settings-status">
        {i18n.t("common.loading")}
        {i18n.t("common.loading.ellipsis")}
      </div>
    )
  if (groups.length === 0)
    return (
      <div className="settings-status">
        <span>{i18n.t("dialog.model.empty")}</span>
        {props.filter && <span className="text-foreground">&quot;{props.filter}&quot;</span>}
      </div>
    )
  return (
    <>
      {groups.map((group) => {
        const expanded = searching || !props.collapsed[group.provider]
        const all = props.models.filter((model) => model.provider.id === group.provider)
        return (
          <section
            key={group.provider}
            className="settings-section"
            data-component="settings-models-provider"
            data-expanded={expanded ? "" : undefined}
          >
            <h3 className="settings-section-title flex items-center justify-between gap-2">
              <button
                type="button"
                className="settings-models-group-trigger"
                aria-expanded={expanded}
                disabled={searching}
                onClick={() => props.onCollapse(group.provider, expanded)}
              >
                {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                <ProviderIcon id={group.provider} />
                <span>{group.name}</span>
              </button>
              {props.providerSwitch && (
                <Switch
                  className="me-6"
                  aria-label={group.name}
                  checked={all.every(visible)}
                  onCheckedChange={(checked) =>
                    all.forEach((model) =>
                      prefs.setVisibility({ providerID: model.provider.id, modelID: model.id }, checked),
                    )
                  }
                />
              )}
            </h3>
            {expanded && (
              <SettingsList variant="catalog">
                {group.items.map((model) => {
                  const key = { providerID: model.provider.id, modelID: model.id }
                  return (
                    <SettingsRow key={modelKey(key)} title={model.name}>
                      <SettingSwitch
                        label={model.name}
                        checked={visible(model)}
                        onChange={(checked) => prefs.setVisibility(key, checked)}
                      />
                    </SettingsRow>
                  )
                })}
              </SettingsList>
            )}
          </section>
        )
      })}
    </>
  )
}
