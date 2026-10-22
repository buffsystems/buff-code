import { Select } from "@opencode/ui/select"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { SettingsRow } from "@/settings/row"

const OPTIONS: ("horizontal" | "vertical")[] = ["vertical", "horizontal"]

/**
 * Вкладки сессий (#470): колонка сессий с состояниями, закреплением и группами (#452) — главный
 * вид окна, поэтому выбор — во «Внешнем виде», а не в экспериментальных настройках.
 */
export function BuffTabLayoutRow() {
  const language = useLanguage()
  const settings = useSettings()
  return (
    <SettingsRow
      title={language.t("settings.appearance.row.tabs.title")}
      description={language.t("settings.appearance.row.tabs.description")}
    >
      <Select
        data-action="settings-tab-layout"
        options={OPTIONS}
        current={OPTIONS.find((option) => option === settings.appearance.tabLayout())}
        placement="bottom-end"
        gutter={6}
        label={(option) =>
          option === "horizontal"
            ? language.t("settings.appearance.row.tabs.horizontal")
            : language.t("settings.appearance.row.tabs.vertical")
        }
        onSelect={(option) => option && settings.appearance.setTabLayout(option)}
      />
    </SettingsRow>
  )
}
