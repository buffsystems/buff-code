// Providers (#584), ported from the Solid window's settings/providers/providers.tsx: the connected
// providers with how each is connected and «Disconnect», and the well-known ones to connect.
// Buff (#466): connecting is signing in — Buff's row shows as soon as one is signed in, with the
// account, and offers to choose an organization and project until models appear; (#455) the
// organization's balance; signing in to Buff when not signed in.

import "../../providers/providers.css"
import { Badge, Button, Dialog, DialogBody } from "@buff/ui/react"
import {
  BUFF_PROVIDER,
  connectedRows,
  providerTag,
  signInOffered,
  type ConnectedRow,
} from "@opencode/app/react-reuse/buff-providers"
import type { Provider } from "@opencode/app/react-reuse/server-types"
import { BuffProvider } from "@opencode/schema/buff-provider"
import { Plus } from "lucide-react"
import { at, useBuffList } from "../../buff/settings/rpc"
import { OwnProviderForm } from "../../providers/own/form"
import { openModelCheck } from "../../providers/own/model-check"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import type { DialogStack } from "../../dialog/dialogs"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { BuffBillingSection } from "../../buff/billing/billing"
import { useBuffContextChoice } from "../../buff/context/choice"
import { popularProviders, useProviderCatalog } from "../../providers/catalog/use-catalog"
import { openConnectProvider } from "../../providers/connect/open"
import { ProviderIcon } from "../../providers/provider-icon"
import type { Server } from "../../core/servers"
import { SettingsBody, SettingsHeader, SettingsList, SettingsSection } from "../kit"
import { useSettingsScope } from "../scope"

const NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

type Source = "env" | "api" | "config" | "custom"

export function SettingsProviders() {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const scope = useSettingsScope()
  const directory = scope.directory
  const catalog = useProviderCatalog(scope.server, directory)
  const integration = (id: string) => catalog.integrations.find((item) => item.id === id)
  const connect = (provider?: string) => openConnectProvider(dialog, { server: scope.server, directory, provider })

  // #562: one's own servers live in the user's configuration; they get their own section.
  const ownRpc = scope.server.api().rpc(BuffProvider.Rpc)
  const own = useBuffList<readonly BuffProvider.Entry[]>({
    server: scope.server,
    name: "own-providers",
    directory,
    empty: [],
    load: () => ownRpc.list(undefined, at(directory)),
    subscribe: (signal) => ownRpc.events.subscribe("changed", { signal }),
    delays: [1000, 3000],
  })
  const ownIDs = new Set(own.value.map((entry) => entry.id))
  // A refused key is replaced where it was entered: an own server's form, or the provider's connection.
  const check = (providerID: string, name: string) => {
    const entry = own.value.find((item) => item.id === providerID)
    openModelCheck(dialog, {
      server: scope.server,
      directory,
      providerID,
      name,
      onReplaceKey: () =>
        entry
          ? openOwnEdit(dialog, { server: scope.server, directory, entry, onSaved: own.settle })
          : connect(providerID),
    })
  }
  const removeOwn = (entry: BuffProvider.Entry) =>
    ownRpc.remove({ id: entry.id }, at(directory)).then(
      () => {
        own.settle()
        showToast({
          variant: "success",
          title: i18n.t("provider.disconnect.toast.disconnected.title", { provider: entry.name }),
          description: i18n.t("provider.disconnect.toast.disconnected.description", { provider: entry.name }),
        })
      },
      (error: unknown) => showToast({ title: i18n.t("common.requestFailed"), description: formatServerError(error) }),
    )

  const connected = catalog.connected
    .filter((item) => !ownIDs.has(item.id))
    .filter((item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost.input > 0))
  const rows = connectedRows(connected, catalog.integrations).filter((row) => !ownIDs.has(row.id))
  const provider = (row: ConnectedRow) => connected.find((item) => item.id === row.id)
  const connectedIDs = new Set(connected.map((item) => item.id))
  const popular = catalog.popular
    .filter((item) => !connectedIDs.has(item.id))
    .toSorted((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))

  // Like the TUI: credentials are an API key or an OAuth grant, env connections are detected
  // variables, an integration without connections comes from the config.
  const source = (item: Provider): Source | undefined => {
    const current = integration(item.id)
    if (current?.connections.some((connection) => connection.type === "credential")) return "api"
    if (current?.connections.some((connection) => connection.type === "env")) return "env"
    if (current) return "config"
    return item.source
  }
  const type = (row: ConnectedRow) => {
    const tag = providerTag(row.id)
    if (tag) return t(tag)
    const item = provider(row)
    const current = item ? source(item) : "api"
    if (current === "env") return i18n.t("settings.providers.tag.environment")
    if (current === "api") return i18n.t("provider.connect.method.apiKey")
    if (current === "config") return i18n.t("settings.providers.tag.config")
    if (current === "custom") return i18n.t("settings.providers.tag.custom")
    return i18n.t("settings.providers.tag.other")
  }
  const canDisconnect = (row: ConnectedRow) => {
    const current = integration(row.id)
    if (current) return current.connections.some((connection) => connection.type === "credential")
    const item = provider(row)
    const value = item ? source(item) : undefined
    return value !== "env" && value !== "config"
  }

  const disconnect = async (providerID: string, name: string) => {
    const location = directory ? { directory } : undefined
    await scope.server
      .api()
      .integration.get({ integrationID: providerID, location })
      .then(async (result) => {
        const credentials = result.data.connections.filter((item) => item.type === "credential")
        if (credentials.length === 0) throw new Error(`No removable credentials found for ${name}`)
        await Promise.all(
          credentials.map((credential) => scope.server.api().credential.remove({ credentialID: credential.id })),
        )
        showToast({
          variant: "success",
          title: i18n.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: i18n.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((error: unknown) =>
        showToast({
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
  }

  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.providers.title")}
        description={t("Your sign-in to Buff, the models of your organization and your own providers.")}
      />
      <SettingsBody sectioned className="settings-providers">
        <div data-component="connected-providers-section">
          <SettingsSection title={i18n.t("settings.providers.section.connected")}>
            <SettingsList variant="catalog">
              {rows.length === 0 && (
                <div className="settings-empty-line">{i18n.t("settings.providers.connected.empty")}</div>
              )}
              {rows.map((row) => (
                <div key={row.id} className="settings-entity-row">
                  <div className="settings-entity-lead">
                    <ProviderIcon id={row.id} />
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="settings-entity-name truncate">{row.name}</span>
                      <Badge>{type(row)}</Badge>
                      {row.account && <span className="settings-entity-description">{row.account}</span>}
                      {row.pending && (
                        <span className="settings-entity-description">
                          {t("Models will appear after you choose an organization and project")}
                        </span>
                      )}
                    </div>
                  </div>
                  {row.pending && row.id === BUFF_PROVIDER && directory && (
                    <ChooseContext server={scope.server} directory={directory} />
                  )}
                  {row.id !== BUFF_PROVIDER && !row.pending && (
                    <Button variant="ghost" data-action="provider-check" onClick={() => check(row.id, row.name)}>
                      {t("Check")}
                    </Button>
                  )}
                  {canDisconnect(row) ? (
                    <Button variant="ghost" onClick={() => void disconnect(row.id, row.name)}>
                      {i18n.t("common.disconnect")}
                    </Button>
                  ) : (
                    <span className="ui-hint">{i18n.t("settings.providers.connected.environmentDescription")}</span>
                  )}
                </div>
              ))}
            </SettingsList>
          </SettingsSection>
        </div>

        <div data-component="own-providers-section">
          <SettingsSection title={t("Your own servers")}>
            <SettingsList variant="catalog">
              {own.value.length === 0 && (
                <div className="settings-empty-line">
                  {t("LiteLLM or any OpenAI-compatible server: its address, key and models.")}
                </div>
              )}
              {own.value.map((entry) => (
                <div key={entry.id} className="settings-entity-row" data-provider-id={entry.id}>
                  <div className="settings-entity-lead">
                    <ProviderIcon id={entry.id} />
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="settings-entity-name truncate">{entry.name}</span>
                      <Badge>{entry.hasKey ? i18n.t("provider.connect.method.apiKey") : t("No key")}</Badge>
                      <span className="settings-entity-description truncate">{entry.baseURL}</span>
                    </div>
                  </div>
                  <Button variant="ghost" data-action="provider-check" onClick={() => check(entry.id, entry.name)}>
                    {t("Check")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => openOwnEdit(dialog, { server: scope.server, directory, entry, onSaved: own.settle })}
                  >
                    {t("Edit")}
                  </Button>
                  <Button variant="ghost" onClick={() => void removeOwn(entry)}>
                    {t("Remove")}
                  </Button>
                </div>
              ))}
            </SettingsList>
            <div className="flex flex-wrap gap-2">
              <Button leadingIcon={Plus} onClick={() => connect("own:litellm")}>
                {t("Add LiteLLM")}
              </Button>
              <Button variant="outline" leadingIcon={Plus} onClick={() => connect("own:custom")}>
                {t("Add an OpenAI-compatible server")}
              </Button>
            </div>
          </SettingsSection>
        </div>

        <BuffBillingSection server={scope.server} directory={directory} />

        {signInOffered(catalog.integrations) && (
          <div data-component="buff-sign-in-section">
            <Button leadingIcon={Plus} onClick={() => connect(BUFF_PROVIDER)}>
              {t("Sign in to Buff")}
            </Button>
          </div>
        )}

        {popular.length > 0 && (
          <SettingsSection title={i18n.t("settings.providers.section.popular")}>
            <SettingsList variant="catalog">
              {popular.map((item) => {
                const note = NOTES.find((entry) => entry.match(item.id))?.key
                return (
                  <div key={item.id} className="settings-entity-row">
                    <div className="settings-entity-lead">
                      <ProviderIcon id={item.id} />
                      <div className="settings-entity-copy">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="settings-entity-name">{item.name}</span>
                        </div>
                        {note && <p className="settings-entity-description">{i18n.t(note)}</p>}
                      </div>
                    </div>
                    <Button leadingIcon={Plus} onClick={() => connect(item.id)}>
                      {i18n.t("common.connect")}
                    </Button>
                  </div>
                )
              })}
            </SettingsList>
            <div>
              <Button variant="link" onClick={() => connect()}>
                {i18n.t("dialog.provider.viewAll")}
              </Button>
            </div>
          </SettingsSection>
        )}
      </SettingsBody>
    </>
  )
}

// Buff (#470): where signing in brought no models yet, choose the organization and project.
function ChooseContext(props: { server: Server; directory: string }) {
  const t = useI18n().buff.t
  const context = useBuffContextChoice(props.server, props.directory)
  return <Button onClick={() => void context.choose(null)}>{t("Choose an organization and project")}</Button>
}

// #562: editing one's own server — the same form, filled in; the key stays unless a new one is typed.
function openOwnEdit(
  dialog: DialogStack,
  input: { server: Server; directory?: string; entry: BuffProvider.Entry; onSaved: () => void },
) {
  return dialog.show((close) => <OwnEdit {...input} onClose={close} />)
}

function OwnEdit(props: {
  server: Server
  directory?: string
  entry: BuffProvider.Entry
  onSaved: () => void
  onClose: () => void
}) {
  const i18n = useI18n()
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={props.entry.name}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <OwnProviderForm
          server={props.server}
          directory={props.directory}
          preset={props.entry.id === "litellm" ? "litellm" : "custom"}
          entry={props.entry}
          onSaved={() => {
            props.onSaved()
            props.onClose()
          }}
        />
      </DialogBody>
    </Dialog>
  )
}
