// The network in Preferences (#461), desktop only, ported from the Solid window's
// network-settings.tsx: the proxy, its login, the exceptions and the organization's certificate.
// They apply to the whole app after a restart, which is offered once saved.

import { Button, Callout, Field, Input } from "@buff/ui/react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import type { BuffNetworkPlatform, BuffNetworkSettings } from "../../platform/platform"
import { SettingsList, SettingsSection } from "../kit"

type Form = { proxy: string; noProxy: string; caFile: string; username: string; password: string }

export function NetworkSettings() {
  const network = usePlatform().buffNetwork
  if (!network) return null
  return <Network network={network} />
}

function Network(props: { network: BuffNetworkPlatform }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const saved = useQuery({ queryKey: ["buff-network"], queryFn: () => props.network.get() })
  return (
    <SettingsSection title={t("Network")} label={t("Network")}>
      <SettingsList>
        <div data-component="buff-network-settings">
          {saved.data && (
            <NetworkForm network={props.network} saved={saved.data} onSaved={() => void saved.refetch()} />
          )}
        </div>
      </SettingsList>
    </SettingsSection>
  )
}

function NetworkForm(props: { network: BuffNetworkPlatform; saved: BuffNetworkSettings; onSaved: () => void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const restartApp = usePlatform().restart
  const [form, setForm] = useState<Form>({ ...props.saved, password: "" })
  const [problem, setProblem] = useState<string>()
  const [restart, setRestart] = useState(false)
  const edit = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }))
  const save = async (forget: boolean) => {
    const password = forget ? { password: "" } : form.password ? { password: form.password } : {}
    const answer = await props.network.set({
      proxy: form.proxy,
      noProxy: form.noProxy,
      caFile: form.caFile,
      username: form.username,
      ...password,
    })
    setProblem(answer ?? undefined)
    if (answer) return
    setRestart(true)
    props.onSaved()
  }
  const pick = async () => {
    const file = await props.network.pickCertificate()
    if (file) edit("caFile")(file)
  }

  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="ui-hint">
        {t(
          "For the window, the service (company connector, models, MCP) and updates. Empty — the proxy from the system settings. Applies after a restart.",
        )}
      </p>
      <Field label={t("Proxy server")}>
        <Input
          value={form.proxy}
          placeholder="http://proxy.company.local:3128"
          onChange={(event) => edit("proxy")(event.currentTarget.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("Login")}>
          <Input
            value={form.username}
            placeholder={t("if the proxy asks")}
            onChange={(event) => edit("username")(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("Password")}>
          <Input
            type="password"
            value={form.password}
            disabled={!props.saved.canEncrypt}
            placeholder={props.saved.hasPassword ? t("saved — enter a new one to replace it") : ""}
            onChange={(event) => edit("password")(event.currentTarget.value)}
          />
        </Field>
      </div>
      {!props.saved.canEncrypt && (
        <p className="ui-hint">{t("The system has no key storage — the password cannot be saved.")}</p>
      )}
      <Field label={t("No proxy")} hint={t("Separated by commas: addresses and masks to reach directly.")}>
        <Input
          value={form.noProxy}
          placeholder="*.company.local, 10.0.0.0/8"
          onChange={(event) => edit("noProxy")(event.currentTarget.value)}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Field label={t("Organization certificate")} className="flex-1">
          <Input
            value={form.caFile}
            placeholder={t("a .pem file — if the proxy substitutes certificates")}
            onChange={(event) => edit("caFile")(event.currentTarget.value)}
          />
        </Field>
        <Button data-action="buff-network-pick" onClick={() => void pick()}>
          {t("Choose a file…")}
        </Button>
      </div>
      {problem && (
        <p className="ui-error" role="alert" data-slot="problem">
          {t(problem)}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" data-action="buff-network-save" onClick={() => void save(false)}>
          {t("Save")}
        </Button>
        {props.saved.hasPassword && (
          <Button variant="ghost" data-action="buff-network-forget" onClick={() => void save(true)}>
            {t("Forget the password")}
          </Button>
        )}
      </div>
      {restart && (
        <Callout
          tone="ok"
          role="status"
          action={
            <Button data-action="buff-network-restart" onClick={() => void restartApp()}>
              {t("Restart now")}
            </Button>
          }
        >
          {t("Saved. The new network settings take effect after Buff Code restarts.")}
        </Callout>
      )}
    </div>
  )
}
