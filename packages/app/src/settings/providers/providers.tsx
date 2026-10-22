import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { showToast } from "@/shell/notifications/toast"
import { popularProviders, useProviders } from "@/providers/catalog/providers"
import { useIntegrations } from "@/providers/catalog/integrations"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { DialogConnectProvider, useProviderConnectController } from "@/providers/connect/dialog"
import { SettingsList } from "@/settings/list"
import { useSettingsDirectory } from "@/settings/server-scope"
import { BuffBillingSection } from "@/buff/billing"
import { BUFF_PROVIDER, connectedRows, providerTag, signInOffered, type ConnectedRow } from "@/buff/providers"
import { useBuffText } from "@/buff/i18n"
import { BuffChooseContextButton } from "@/buff/context-chip"
import "@/settings/settings.css"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

const PROVIDER_ICON_SIZE = 16

export const SettingsProviders: Component<{
  directory: string | undefined
  onBack?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  // Buff (#472): подпись способа подключения Buff — английская строка, переводится.
  const { t } = useBuffText()
  const serverSdk = useServerSDK()
  // Buff (#466): настройки сервера смотрят в каталог, где контекст выбирали последним.
  const scoped = useSettingsDirectory()
  const directory = () => props.directory ?? scoped()
  const providers = useProviders(directory)
  const integrations = useIntegrations(directory)
  const providerConnect = useProviderConnectController({ onBack: props.onBack })
  const integration = (providerID: string) => integrations.list().find((item) => item.id === providerID)

  const connect = (provider?: string) => {
    providerConnect.select(provider)
    void dialog.show(() => <DialogConnectProvider directory={directory()} controller={providerConnect} />)
  }

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter(
        (provider) =>
          provider.id !== "opencode" || Object.values(provider.models).some((model) => model.cost.input > 0),
      )
  })

  // Buff (#466): подключение — это вход; строка есть и до того, как появились модели.
  const rows = createMemo(() => connectedRows(connected(), integrations.list()))
  const provider = (row: ConnectedRow) => connected().find((item) => item.id === row.id)

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  // Connection state comes from the integration list like the TUI: credential
  // connections mean an API key or OAuth grant, env connections mean detected
  // environment variables, and a connectionless integration is config-provided.
  const source = (item: ProviderItem): ProviderSource | undefined => {
    const current = integration(item.id)
    if (current?.connections.some((connection) => connection.type === "credential")) return "api"
    if (current?.connections.some((connection) => connection.type === "env")) return "env"
    if (current) return "config"
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (row: ConnectedRow) => {
    const tag = providerTag(row.id)
    if (tag) return t(tag)
    const item = provider(row)
    const current = item ? source(item) : "api"
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") return language.t("settings.providers.tag.config")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (row: ConnectedRow) => {
    const current = integration(row.id)
    if (current) return current.connections.some((connection) => connection.type === "credential")
    const item = provider(row)
    const currentSource = item ? source(item) : undefined
    return currentSource !== "env" && currentSource !== "config"
  }

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const disconnect = async (providerID: string, name: string) => {
    const at = directory()
    const location = at ? { directory: at } : undefined
    await serverSdk.api.integration
      .get({ integrationID: providerID, location })
      .then(async (integration) => {
        const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []
        if (credentials.length === 0) throw new Error(`No removable credentials found for ${name}`)
        await Promise.all(
          credentials.map((credential) => serverSdk.api.credential.remove({ credentialID: credential.id })),
        )
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.providers.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {t("Your sign-in to Buff and the models of your organization.")}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned settings-providers">
        <div class="settings-section" data-component="connected-providers-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList variant="catalog">
            <Show
              when={rows().length > 0}
              fallback={<div class="settings-provider-empty">{language.t("settings.providers.connected.empty")}</div>}
            >
              <For each={rows()}>
                {(item) => (
                  <div class="settings-provider-row group">
                    <div class="settings-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-provider-icon shrink-0"
                      />
                      <div class="settings-provider-main">
                        <span class="settings-provider-name truncate">{item.name}</span>
                        <Badge>{type(item)}</Badge>
                        <Show when={item.account}>
                          {(account) => <span class="settings-provider-description">{account()}</span>}
                        </Show>
                        <Show when={item.pending}>
                          <span class="settings-provider-description">
                            {t("Models will appear after you choose an organization and project")}
                          </span>
                        </Show>
                      </div>
                    </div>
                    <Show when={item.pending && item.id === BUFF_PROVIDER && directory()}>
                      {(dir) => <BuffChooseContextButton directory={dir} />}
                    </Show>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="settings-provider-env-hint">
                          {language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <Button size="normal" variant="ghost-muted" onClick={() => void disconnect(item.id, item.name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        {/* Buff (#455): остаток организации и ссылка в кабинет. */}
        <BuffBillingSection directory={directory()} />

        <Show when={signInOffered(integrations.list())}>
          <div class="settings-section" data-component="buff-sign-in-section">
            <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(BUFF_PROVIDER)}>
              {t("Sign in to Buff")}
            </Button>
          </div>
        </Show>

        <Show when={popular().length > 0}>
          <div class="settings-section">
            <h3 class="settings-section-title">{language.t("settings.providers.section.popular")}</h3>
            <SettingsList variant="catalog">
              <For each={popular()}>
                {(item) => (
                  <div class="settings-provider-row">
                    <div class="settings-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-provider-icon shrink-0"
                      />
                      <div class="settings-provider-copy">
                        <div class="settings-provider-main">
                          <span class="settings-provider-name">{item.name}</span>
                        </div>
                        <Show when={note(item.id)}>
                          {(key) => <p class="settings-provider-description">{language.t(key())}</p>}
                        </Show>
                      </div>
                    </div>
                    <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                      {language.t("common.connect")}
                    </Button>
                  </div>
                )}
              </For>
            </SettingsList>

            <button type="button" class="settings-providers-view-all" onClick={() => connect()}>
              {language.t("dialog.provider.viewAll")}
            </button>
          </div>
        </Show>
      </div>
    </>
  )
}
