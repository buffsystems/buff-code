import { Button } from "@opencode/ui/button"
import { openBuffSignIn } from "./sign-in"
import { onboardingPending } from "./onboarding"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { List } from "@opencode/ui/list"
import { BuffContext } from "@opencode/schema/buff-context"
import {
  chooseOrg,
  chooseProject,
  chooseSpaces,
  launchStep,
  type Ask,
  type AskOption,
} from "@opencode/schema/buff-context-flow"
import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { useIntegrations } from "@/providers/catalog/integrations"
import { buffSignedIn } from "./providers"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"

/**
 * Рабочий контекст Buff в десктопе (#391): кнопка «◆ организация › проект» под полем ввода.
 * По нажатию — выбор из списков разрешённого, те же шаги, что в терминале; в каталоге, где
 * контекст ещё не выбран, выбор открывается сам, а без входа в Buff сначала открывается вход
 * (#401) — отдельных команд для этого нет. Переключение из консоли или терминала приходит
 * событием.
 */

type Choice = BuffContext.Choice

const message = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)
const failure = (error: unknown) => ({
  type: typeof error === "object" && error !== null && "type" in error ? String(error.type) : undefined,
  message: message(error),
})

function Pick<Value>(props: {
  title: string
  options: readonly AskOption<Value>[]
  current?: Value
  empty?: string
  onPick: (value: Value) => void
}) {
  const { t } = useBuffText()
  const items = () => [...props.options]
  const current = () => items().find((item) => item.value === props.current)
  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <List
          class="flex-1 px-3 min-h-0"
          search={{ placeholder: t("Search"), autofocus: true }}
          emptyMessage={props.empty ?? t("Empty")}
          key={(item) => item.title}
          items={items}
          current={current()}
          filterKeys={["title"]}
          onSelect={(item) => item && props.onPick(item.value)}
        >
          {(item) => (
            <div class="w-full flex items-center gap-2">
              <span class="truncate flex-1 min-w-0 text-left font-normal">{item.title}</span>
              <span class="text-text-weak shrink-0 font-normal">{item.description ?? ""}</span>
            </div>
          )}
        </List>
      </DialogBody>
    </Dialog>
  )
}

/**
 * Выбор контекста и вход — для чипа под полем ввода и для карточки отказа хода (#458): у обоих
 * одно и то же окно выбора, один и тот же вход.
 */
export function useBuffContextChoice(directory?: () => string) {
  const sdk = useServerSDK()
  // #470: в настройках контекста места нет — там каталог передают явно.
  const workspace = directory ? undefined : useWorkspaceLocation()
  const dir = () => (directory ? directory() : workspace!().directory)
  const location = () => ({ directory: dir() })
  const dialog = useDialog()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffContext.Rpc)
  const at = () => ({ location: { directory: dir() } })

  const ask: Ask = (d) =>
    new Promise((resolve) => {
      let settled = false
      const settle = (value: unknown) => {
        if (settled) return
        settled = true
        resolve(value as never)
      }
      dialog.show(
        () => (
          <Pick
            title={d.title}
            options={d.options}
            current={d.current}
            empty={d.empty}
            onPick={(value) => {
              settle(value)
              dialog.close()
            }}
          />
        ),
        () => settle(undefined),
      )
    })

  /** Выбранный контекст или undefined, если выбор отменён либо не удался (причина — тостом). */
  const choose = async (current: Choice | null): Promise<Choice | undefined> => {
    try {
      const options = await rpc.options(undefined, at())
      const org = await chooseOrg(ask, options, current, t)
      if (org === undefined) return
      const project = await chooseProject(ask, options, org, BuffContext.preselectProject(current, org), t)
      if (project === undefined) return
      const same = current?.org === org
      const spaces = await chooseSpaces(ask, options, org, same ? (current?.spaces ?? []) : [], t)
      if (spaces === undefined) return
      const kept = await rpc.set({ org, project, spaces }, at())
      showToast({ title: t("Buff context"), description: BuffContext.label(kept, t) })
      return kept
    } catch (error) {
      showToast({ title: t("Buff context"), description: message(error) })
      return
    }
  }

  // Вход — в окне подключения, сразу на Buff: адрес коннектора, код, ожидание.
  const signIn = (onClose?: () => void) => openBuffSignIn(dialog, location().directory, onClose)

  return { rpc, at, location, choose, signIn }
}

/** Кнопка выбора организации и проекта (#470) — там, где после входа моделей ещё нет. */
export function BuffChooseContextButton(props: { directory: () => string }) {
  const context = useBuffContextChoice(props.directory)
  const { t } = useBuffText()
  return (
    <Button size="normal" variant="neutral" onClick={() => void context.choose(null)}>
      {t("Choose an organization and project")}
    </Button>
  )
}

export function BuffContextChip() {
  const context = useBuffContextChoice()
  const { rpc, at, location } = context
  const { t } = useBuffText()
  const [choice, setChoice] = createSignal<Choice | null>(null)
  const [signedOut, setSignedOut] = createSignal(false)

  const choose = async () => {
    const kept = await context.choose(choice())
    if (kept) setChoice(kept)
  }

  // Когда окно входа закрыли, всё проверяется заново — но вход сам не открывается второй раз:
  // чип зовёт его.
  const signIn = () => context.signIn(() => void launch(false))

  const launch = async (openSignIn: boolean) => {
    const saved = await rpc.get(undefined, at()).catch(() => null)
    setChoice(saved)
    const problem = await rpc.options(undefined, at()).then(() => undefined, failure)
    const step = launchStep(saved, problem)
    setSignedOut(step === "sign_in")
    // #457: при первом запуске вход открывает знакомство, а не чип.
    if (step === "sign_in") return openSignIn && !onboardingPending() ? signIn() : undefined
    if (step === "unreachable") return showToast({ title: t("Buff context"), description: problem!.message })
    // Первый запуск в каталоге всегда спрашивает (#391).
    if (step === "choose") await choose()
  }

  // #457: вход мог пройти не через чип (плашка «нет модели», знакомство) — чип узнаёт о нём
  // и, как после своего входа, предлагает выбрать организацию и проект.
  const integrations = useIntegrations(() => location().directory)
  createEffect(
    on(
      () => buffSignedIn(integrations.list()),
      (now, before) => {
        if (now && before === false && signedOut()) void launch(false).catch(() => undefined)
      },
    ),
  )

  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void launch(true).catch(() => undefined)
    void (async () => {
      for await (const event of rpc.events.subscribe("changed", { signal: stop.signal })) {
        if (event.location?.directory !== location().directory) continue
        setChoice(event.data as Choice)
      }
    })().catch(() => undefined)
  })

  return (
    <Button
      data-action="buff-context"
      variant="ghost-muted"
      size="normal"
      style={{ height: "28px" }}
      class="min-w-0 max-w-[320px] justify-start ![font-weight:440]"
      classList={{ "text-icon-warning-base": signedOut() || !choice() }}
      title={t("Buff working context: organization, project, knowledge spaces")}
      onClick={() => (signedOut() ? signIn() : void choose())}
    >
      <span class="truncate leading-4">
        ◆ {signedOut() ? t("Sign in to Buff") : choice() ? BuffContext.label(choice(), t) : t("Choose a Buff context")}
      </span>
    </Button>
  )
}
