import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { BuffBackground } from "@opencode/schema/buff-background"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"
import { readShellOutput } from "./shell-follow"
// Список «Фоновой работы» стоит и под полем ввода, где сводка сессии ещё не загружала свои стили.
import "@/session/summary/summary.css"
import "./background-work.css"

/**
 * Фоновая работа в окне (#456): у строки «Фоновой работы» — сколько она идёт, «Стоп» и у команды
 * «Вывод» — окно с живым выводом целиком. Остановленная человеком работа модель не будит
 * (решает ядро, `buff.background`); слова и время — общие с консолью (`BuffBackground`).
 */

export type BackgroundItem = { readonly id: string; readonly type: "shell" | "subagent"; readonly label: string }

// Одни часы на все строки: тикают, пока хоть одна строка на экране.
const [now, setNow] = createSignal(Date.now())
let watchers = 0
let clock: ReturnType<typeof setInterval> | undefined
function useNow() {
  onMount(() => {
    watchers += 1
    clock ??= setInterval(() => setNow(Date.now()), 1_000)
    setNow(Date.now())
  })
  onCleanup(() => {
    watchers -= 1
    if (watchers > 0 || !clock) return
    clearInterval(clock)
    clock = undefined
  })
  return now
}

function useStop() {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const { t } = useBuffText()
  return (item: BackgroundItem) =>
    sdk.api
      .rpc(BuffBackground.Rpc)
      .stop({ id: item.id }, { location: { directory: location().directory } })
      .then(
        (result) => {
          if (!result.stopped) showToast({ title: item.label, description: t("Already finished.") })
        },
        (error: unknown) =>
          showToast({ title: item.label, description: formatServerError(error, undefined, t("Could not stop.")) }),
      )
}

/** Вывод фоновой команды: всё, что она написала, и дописывается, пока она идёт. */
function ShellOutputDialog(props: { item: BackgroundItem; started?: number }) {
  const sdk = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const stop = useStop()
  const time = useNow()
  const { t } = useBuffText()
  const [text, setText] = createSignal("")
  const [gone, setGone] = createSignal(false)
  const running = () => data.shell.list({ directory: location().directory }).some((shell) => shell.id === props.item.id)
  let view: HTMLPreElement | undefined
  onMount(() => {
    let cursor = 0
    let busy = false
    const load = (from: number) =>
      sdk.api.shell
        .output({ id: props.item.id, location: { directory: location().directory }, cursor: from })
        .then((response) => response.data)
    const read = async () => {
      if (busy) return
      busy = true
      const page = await readShellOutput(load, cursor).catch(() => undefined)
      busy = false
      if (!page) return setGone(true)
      cursor = page.cursor
      if (!page.output) return
      const pinned = !view || view.scrollTop + view.clientHeight >= view.scrollHeight - 8
      setText((value) => value + page.output)
      if (pinned) queueMicrotask(() => view?.scrollTo({ top: view.scrollHeight }))
    }
    void read()
    const timer = setInterval(() => void (running() ? read() : undefined), 1_000)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{t("Command output")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-bg-output" data-component="buff-background-output">
          <div class="buff-bg-output-head">
            <code class="buff-bg-output-command">{props.item.label}</code>
            <span class="buff-bg-time">
              {running() ? (BuffBackground.since(props.started, time(), t) ?? t("running")) : t("finished")}
            </span>
            <Show when={running()}>
              <Button
                size="small"
                variant="neutral"
                data-action="buff-background-stop"
                onClick={() => void stop(props.item)}
              >
                {t("Halt")}
              </Button>
            </Show>
          </div>
          <pre ref={view} class="buff-bg-output-text" data-slot="output">
            {text() || (gone() ? t("The output is no longer available.") : t("Nothing written yet."))}
          </pre>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/** Время работы, «Вывод» и «Стоп» в строке «Фоновой работы». */
export function BuffBackgroundControls(props: { item: BackgroundItem; started?: number; onOpen?: () => void }) {
  const dialog = useDialog()
  const stop = useStop()
  const time = useNow()
  const { t } = useBuffText()
  const [stopping, setStopping] = createSignal(false)
  // Строка агента — ссылка на его сессию: нажатия на кнопки дальше не идут.
  const press = (event: MouseEvent, action: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }
  return (
    <span class="buff-bg-controls" data-component="buff-background-controls">
      <Show when={BuffBackground.since(props.started, time(), t)}>
        {(value) => <span class="buff-bg-time">{value()}</span>}
      </Show>
      <Show when={props.item.type === "shell"}>
        <button
          type="button"
          class="buff-bg-action"
          data-action="buff-background-output"
          onClick={(event) =>
            press(event, () => {
              props.onOpen?.()
              void dialog.show(() => <ShellOutputDialog item={props.item} started={props.started} />)
            })
          }
        >
          {t("Output")}
        </button>
      </Show>
      <button
        type="button"
        class="buff-bg-action"
        data-action="buff-background-stop"
        disabled={stopping()}
        onClick={(event) =>
          press(event, () => {
            setStopping(true)
            void stop(props.item).finally(() => setStopping(false))
          })
        }
      >
        {t("Halt")}
      </button>
    </span>
  )
}
