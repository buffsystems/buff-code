import { Component, For, createMemo, createResource } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Tabs } from "@opencode/ui/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { BuffMcpSection } from "@/buff/mcp-settings"
import { BuffCustomSection } from "@/buff/custom-settings"
import { BuffHookSection } from "@/buff/hook-settings"
import { BuffMemorySection } from "@/buff/memory-settings"
import { BuffSkillSection } from "@/buff/skill-settings"
import { useBuffText } from "@/buff/i18n"
import { useSettingsDirectory } from "@/settings/server-scope"
import { pluginLabels } from "@/providers/catalog/plugin"
import { SettingsList } from "@/settings/list"
import type { SettingsView } from "@/settings/surface"
import "@/settings/settings.css"

interface PluginRowItem {
  name: string
}

export const SettingsExtensions: Component<{
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
}> = (props) => {
  const language = useLanguage()
  const { t } = useBuffText()
  const serverSdk = useServerSDK()
  const settingsDirectory = useSettingsDirectory()

  const [pluginList] = createResource(
    () => serverSdk.connection.status() === "connected",
    () => serverSdk.api.plugin.list().then((result) => result.data),
    { initialValue: [] },
  )
  const plugins = createMemo<PluginRowItem[]>(() => pluginLabels(pluginList.latest ?? []).map((name) => ({ name })))

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            if (
              value === "mcps" ||
              value === "plugins" ||
              value === "skills" ||
              value === "commands" ||
              value === "agents" ||
              value === "hooks" ||
              value === "memory"
            )
              props.onSubtab(value)
          }}
          class="settings-extensions-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("status.popover.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
            <Tabs.Trigger value="commands">{t("Commands")}</Tabs.Trigger>
            <Tabs.Trigger value="agents">{t("Subagents")}</Tabs.Trigger>
            <Tabs.Trigger value="hooks">{t("Hooks")}</Tabs.Trigger>
            <Tabs.Trigger value="memory">{t("Memory")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            {/* Buff (#444): серверы добавляются, правятся и удаляются здесь же. */}
            <BuffMcpSection directory={settingsDirectory} scopes={["user"]} />
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-text-muted">
                  {language.t("settings.extensions.manageConfig")}
                </span>
              </div>
              <SettingsList variant="catalog">
                <For each={plugins()}>
                  {(plugin) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="settings-extension-name truncate">{plugin.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <BuffSkillSection directory={settingsDirectory} scopes={["user"]} />
          </Tabs.Content>
          <Tabs.Content value="commands">
            <BuffCustomSection kind="command" directory={settingsDirectory} scopes={["user"]} />
          </Tabs.Content>
          <Tabs.Content value="agents">
            <BuffCustomSection kind="agent" directory={settingsDirectory} scopes={["user"]} />
          </Tabs.Content>
          <Tabs.Content value="hooks">
            <BuffHookSection directory={settingsDirectory} scopes={["user"]} />
          </Tabs.Content>
          <Tabs.Content value="memory">
            <BuffMemorySection directory={settingsDirectory} scopes={["user"]} />
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
