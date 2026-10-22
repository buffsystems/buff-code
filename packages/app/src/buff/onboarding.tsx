import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import { BuffTextSize } from "./text-size"
import { usePlatform } from "@/runtime/platform/platform"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffMemory } from "@opencode/schema/buff-memory"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Switch } from "@opencode/ui/switch"
import { useTheme } from "@opencode/ui/theme/context"
import { useServerSDK } from "@/runtime/server/client"
import { useCommand } from "@/shell/commands/command"
import { SettingsRow } from "@/settings/row"
import { useIntegrations } from "@/providers/catalog/integrations"
import { preferForNewSessions } from "./permission-mode"
import { buffSignedIn } from "./providers"
import { openBuffSignIn } from "./sign-in"
import { ServerScope } from "./server-scope"
import { useBuffText } from "./i18n"
import "./onboarding.css"

/**
 * Знакомство с Buff Code (#457) — при первом запуске окна, три шага, как у ZCode, но каждый
 * выбор что-то меняет: род занятий задаёт режим разрешений и «План» новых сессий, тема — вид
 * окна, последний шаг включает память проекта и проверку хуков и команд. «Пропустить» — на
 * любом шаге; пройти заново можно из настроек и командой. Шаги и слова — `BuffFirstRun`.
 */

const DONE_KEY = "buff.onboarding.done"
const COMMAND = "buff.onboarding.show"

function done(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "true"
  } catch {
    return true
  }
}
// Пока знакомство не пройдено или открыто, вход сам не открывается: знакомство кончается им.
const [pending, setPending] = createSignal(!done())
export const onboardingPending = pending

function markDone(): void {
  setPending(false)
  try {
    localStorage.setItem(DONE_KEY, "true")
  } catch {
    // Без хранилища знакомство покажется при следующем запуске ещё раз.
  }
}

function Choice<Value extends string>(props: {
  items: readonly { readonly value: Value; readonly title: string; readonly note?: string }[]
  current: Value | undefined
  onPick: (value: Value) => void
}) {
  const { t } = useBuffText()
  return (
    <div class="buff-onboarding-choices" role="radiogroup">
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.current === item.value}
            class="buff-onboarding-choice"
            data-active={props.current === item.value}
            data-value={item.value}
            onClick={() => props.onPick(item.value)}
          >
            <span class="buff-onboarding-choice-title">{t(item.title)}</span>
            <Show when={item.note}>
              <span class="buff-onboarding-choice-note">{t(item.note ?? "")}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}

function OnboardingDialog() {
  const dialog = useDialog()
  const sdk = useServerSDK()
  const theme = useTheme()
  const { t } = useBuffText()
  const integrations = useIntegrations(() => undefined)
  const [step, setStep] = createSignal(0)
  const [role, setRole] = createSignal<BuffFirstRun.Role["value"]>("develop")
  const [scheme, setScheme] = createSignal<(typeof BuffFirstRun.THEMES)[number]["value"]>(theme.colorScheme())
  const [memory, setMemory] = createSignal(true)
  const [askFirst, setAskFirst] = createSignal(true)

  onMount(() => {
    void sdk.api
      .rpc(BuffMemory.Rpc)
      .list()
      .then(
        (state) => setMemory(state.enabled),
        () => undefined,
      )
    void sdk.api
      .rpc(BuffTrust.Rpc)
      .get()
      .then(
        (state) => setAskFirst(state.askFirst),
        () => undefined,
      )
  })

  const pickTheme = (value: (typeof BuffFirstRun.THEMES)[number]["value"]) => {
    setScheme(value)
    theme.setColorScheme(value)
  }
  const finish = async (signIn: boolean) => {
    const chosen = BuffFirstRun.ROLES.find((item) => item.value === role())!
    preferForNewSessions(chosen.mode, chosen.plan)
    await Promise.all([
      sdk.api
        .rpc(BuffMemory.Rpc)
        .enable({ enabled: memory() })
        .catch(() => undefined),
      sdk.api
        .rpc(BuffTrust.Rpc)
        .set({ askFirst: askFirst() })
        .catch(() => undefined),
    ])
    markDone()
    // Вход заменяет знакомство на месте — окно не мигает пустым экраном между ними.
    if (signIn) return openBuffSignIn(dialog, "", undefined, (content) => <ServerScope>{content()}</ServerScope>)
    dialog.close()
  }
  const skip = () => {
    markDone()
    dialog.close()
  }
  const last = () => step() === BuffFirstRun.STEPS.length - 1
  const signedIn = () => buffSignedIn(integrations.list())

  return (
    <Dialog size="large" fit>
      <DialogHeader>
        <DialogTitle>{t("Getting to know Buff Code")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-onboarding" data-component="buff-onboarding" data-step={step() + 1}>
          <div class="buff-onboarding-progress" aria-label={t("Step {n} of {total}", { n: step() + 1, total: BuffFirstRun.STEPS.length })}>
            <For each={BuffFirstRun.STEPS}>
              {(_, index) => <span class="buff-onboarding-dot" data-active={index() <= step()} />}
            </For>
            <span class="buff-onboarding-count">
              {t("Step {n} of {total}", { n: step() + 1, total: BuffFirstRun.STEPS.length })}
            </span>
          </div>
          <h3 class="buff-onboarding-title">{t(BuffFirstRun.STEPS[step()]!.title)}</h3>
          <p class="buff-onboarding-note">{t(BuffFirstRun.STEPS[step()]!.note)}</p>

          <Show when={step() === 0}>
            <Choice items={BuffFirstRun.ROLES} current={role()} onPick={setRole} />
          </Show>
          <Show when={step() === 1}>
            <Choice items={BuffFirstRun.THEMES} current={scheme()} onPick={pickTheme} />
            {/* #461: и размер текста — сразу виден на этом окне. */}
            <div class="buff-onboarding-size">
              <span>{t("Text size")}</span>
              <input
                type="range"
                min={BuffTextSize.UI.min}
                max={BuffTextSize.UI.max}
                step={1}
                value={BuffTextSize.ui()}
                aria-label={t("Text size")}
                data-action="buff-onboarding-size"
                onInput={(event) => BuffTextSize.setUi(Number(event.currentTarget.value))}
              />
              <span class="buff-onboarding-size-value">{BuffTextSize.ui()} px</span>
            </div>
          </Show>
          <Show when={step() === 2}>
            <div class="buff-onboarding-switches">
              <SettingsRow title={t(BuffFirstRun.MEMORY.title)} description={t(BuffFirstRun.MEMORY.note)}>
                <div data-action="buff-onboarding-memory">
                  <Switch checked={memory()} onChange={setMemory} />
                </div>
              </SettingsRow>
              <SettingsRow title={t(BuffFirstRun.ASK_FIRST.title)} description={t(BuffFirstRun.ASK_FIRST.note)}>
                <div data-action="buff-onboarding-ask-first">
                  <Switch checked={askFirst()} onChange={setAskFirst} />
                </div>
              </SettingsRow>
            </div>
          </Show>

          <div class="buff-onboarding-actions">
            <Button size="large" variant="ghost" data-action="buff-onboarding-skip" onClick={skip}>
              {t("Skip")}
            </Button>
            <span class="flex-1" />
            <Show when={step() > 0}>
              <Button
                size="large"
                variant="neutral"
                data-action="buff-onboarding-back"
                onClick={() => setStep(step() - 1)}
              >
                {t("Back")}
              </Button>
            </Show>
            <Show
              when={last()}
              fallback={
                <Button
                  size="large"
                  variant="contrast"
                  data-action="buff-onboarding-next"
                  onClick={() => setStep(step() + 1)}
                >
                  {t("Next")}
                </Button>
              }
            >
              <Button
                size="large"
                variant="contrast"
                data-action="buff-onboarding-finish"
                onClick={() => void finish(!signedIn())}
              >
                {signedIn() ? t("Done") : t("Sign in to Buff")}
              </Button>
            </Show>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

const scoped = () => (
  <ServerScope>
    <OnboardingDialog />
  </ServerScope>
)

/** Показывает знакомство при первом запуске и даёт команду пройти его заново. */
export function BuffOnboarding() {
  const dialog = useDialog()
  const command = useCommand()
  const { t } = useBuffText()
  const show = () => {
    setPending(true)
    void dialog.show(scoped, () => setPending(!done()))
  }
  command.register("buff.onboarding", () => [
    { id: COMMAND, title: t("Show the Buff Code introduction"), category: "Buff", keybind: "mod+shift+h", onSelect: show },
  ])
  // Только при первом запуске: у тех, кто уже работал, знакомство само не открывается.
  const platform = usePlatform()
  let decided = false
  createEffect(() => {
    // Не десктоп — первого запуска не узнать: знакомство только по команде, вход не ждёт его.
    if (!platform.firstLaunch) return void setPending(false)
    const first = platform.firstLaunch()
    if (decided || first === undefined) return
    decided = true
    if (done()) return
    if (first) show()
    else markDone()
  })
  return null
}

/** Строка в «Общих» настройках: пройти знакомство заново. */
export function BuffOnboardingSettingsRow() {
  const dialog = useDialog()
  const { t } = useBuffText()
  return (
    <SettingsRow
      title={t("Getting to know Buff Code")}
      description={t("Three short steps: what you do, the theme, memory and the hooks check. Shortcut — Ctrl+Shift+H.")}
    >
      <Button
        size="normal"
        variant="neutral"
        data-action="buff-onboarding-again"
        onClick={() => void dialog.show(scoped)}
      >
        {t("Go through again")}
      </Button>
    </SettingsRow>
  )
}
