import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { BuffContext } from "@opencode/schema/buff-context"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useProviders } from "@/providers/catalog/providers"
import { useBuffContextChoice } from "./context-chip"
import { buffSignedIn } from "./providers"
import { useBuffText } from "./i18n"
import "./no-model.css"

/**
 * Плашка «нет модели» над полем ввода (#457): пока модели нет, отправка неактивна, а здесь
 * сказано почему и что сделать — войти в Buff или выбрать организацию и проект. Слова —
 * общие с консолью (`BuffFirstRun.noModel`).
 */
export function BuffNoModelStrip() {
  const context = useBuffContextChoice()
  const { t } = useBuffText()
  const directory = () => context.location().directory
  const integrations = useIntegrations(directory)
  const providers = useProviders(directory)
  // undefined — ещё не знаем: плашка не мигает при загрузке.
  const [choice, setChoice] = createSignal<BuffContext.Choice | null | undefined>(undefined)

  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void context.rpc.get(undefined, context.at()).then(setChoice, () => setChoice(null))
    void (async () => {
      for await (const event of context.rpc.events.subscribe("changed", { signal: stop.signal })) {
        if (event.location?.directory === directory()) setChoice(event.data as BuffContext.Choice)
      }
    })().catch(() => undefined)
  })

  const state = () => {
    if (!providers.ready() || choice() === undefined) return undefined
    return BuffFirstRun.noModel({
      signedIn: buffSignedIn(integrations.list()),
      context: !!choice(),
      models: providers.paid().some(([id]) => id === "buff"),
      own: providers.paid().some(([id]) => id !== "buff"),
    })
  }
  const fix = async () => {
    const current = state()
    if (!current) return
    if (current.action === "sign-in") return context.signIn()
    const kept = await context.choose(choice() ?? null)
    if (kept) setChoice(kept)
  }

  return (
    <Show when={state()}>
      {(current) => (
        <div class="buff-no-model" data-component="buff-no-model" data-action-kind={current().action}>
          <Icon name="outline-hexagonal-warning" class="shrink-0" />
          <span class="min-w-0 flex-1">{t(current().text)}</span>
          <Button size="small" variant="contrast" data-action="buff-no-model-fix" onClick={() => void fix()}>
            {current().action === "sign-in" ? t("Sign in to Buff") : t("Choose context")}
          </Button>
        </div>
      )}
    </Show>
  )
}
