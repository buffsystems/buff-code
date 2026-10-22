import { createResource, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { TextField } from "@opencode/ui/text-field"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { useBuffText } from "./i18n"
import "./network-settings.css"

/**
 * Сеть в «Общих» настройках (#461), только в десктопе: прокси, логин и пароль, исключения и свой
 * сертификат организации. Действуют на всё приложение после перезапуска — после сохранения
 * предлагается «Перезапустить сейчас». Пустые поля — прокси из системы, как раньше.
 */
export function BuffNetworkSettings() {
  const platform = usePlatform()
  const { t } = useBuffText()
  const network = platform.buffNetwork
  if (!network) return null
  const [saved, { refetch }] = createResource(() => network.get())
  const [form, setForm] = createStore({ proxy: "", noProxy: "", caFile: "", username: "", password: "" })
  const [dirty, setDirty] = createSignal(false)
  const [problem, setProblem] = createSignal<string>()
  const [restart, setRestart] = createSignal(false)
  const loaded = () => {
    const value = saved()
    if (value && !dirty()) setForm({ ...value, password: "" })
    return value
  }
  const edit = (key: keyof typeof form) => (value: string) => {
    setDirty(true)
    setForm(key, value)
  }
  const save = async (clearPassword = false) => {
    const answer = await network.set({
      proxy: form.proxy,
      noProxy: form.noProxy,
      caFile: form.caFile,
      username: form.username,
      ...(clearPassword ? { password: "" } : form.password ? { password: form.password } : {}),
    })
    setProblem(answer ?? undefined)
    if (answer) return
    setDirty(false)
    setRestart(true)
    void refetch()
  }
  const pick = async () => {
    const file = await network.pickCertificate()
    if (file) edit("caFile")(file)
  }

  return (
    <section class="settings-section" aria-label={t("Network")} data-component="buff-network-settings">
      <h3 class="settings-section-title">{t("Network")}</h3>
      <SettingsList>
        <Show when={loaded()}>
          {(current) => (
            <div class="buff-network">
              <p class="buff-network-note">
                {t(
                  "For the window, the service (company connector, models, MCP) and updates. Empty — the proxy from the system settings. Applies after a restart.",
                )}
              </p>
              <TextField
                label={t("Proxy server")}
                placeholder="http://proxy.company.local:3128"
                value={form.proxy}
                onChange={edit("proxy")}
              />
              <div class="buff-network-pair">
                <TextField
                  label={t("Login")}
                  placeholder={t("if the proxy asks")}
                  value={form.username}
                  onChange={edit("username")}
                />
                <TextField
                  type="password"
                  disabled={!current().canEncrypt}
                  label={t("Password")}
                  placeholder={current().hasPassword ? t("saved — enter a new one to replace it") : ""}
                  value={form.password}
                  onChange={edit("password")}
                />
              </div>
              <Show when={!current().canEncrypt}>
                <p class="buff-network-note">{t("The system has no key storage — the password cannot be saved.")}</p>
              </Show>
              <TextField
                label={t("No proxy")}
                placeholder="*.company.local, 10.0.0.0/8"
                description={t("Separated by commas: addresses and masks to reach directly.")}
                value={form.noProxy}
                onChange={edit("noProxy")}
              />
              <div class="buff-network-file">
                <TextField
                  label={t("Organization certificate")}
                  placeholder={t("a .pem file — if the proxy substitutes certificates")}
                  value={form.caFile}
                  onChange={edit("caFile")}
                />
                <Button size="normal" variant="neutral" data-action="buff-network-pick" onClick={() => void pick()}>
                  {t("Choose a file…")}
                </Button>
              </div>
              <Show when={problem()}>
                <p class="buff-network-problem" data-slot="problem">
                  {t(problem() ?? "")}
                </p>
              </Show>
              <div class="buff-network-actions">
                <Button size="normal" variant="contrast" data-action="buff-network-save" onClick={() => void save()}>
                  {t("Save")}
                </Button>
                <Show when={current().hasPassword}>
                  <Button
                    size="normal"
                    variant="ghost"
                    data-action="buff-network-forget"
                    onClick={() => void save(true)}
                  >
                    {t("Forget the password")}
                  </Button>
                </Show>
              </div>
              <Show when={restart()}>
                <div class="buff-network-restart" data-slot="restart">
                  <span>{t("Saved. The new network settings take effect after Buff Code restarts.")}</span>
                  <Button
                    size="normal"
                    variant="neutral"
                    data-action="buff-network-restart"
                    onClick={() => void platform.restart()}
                  >
                    {t("Restart now")}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </SettingsList>
    </section>
  )
}
