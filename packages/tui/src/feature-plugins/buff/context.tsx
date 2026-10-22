import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffContext } from "@opencode/schema/buff-context"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { ownModel } from "@opencode/schema/buff-context-flow"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { DialogIntegration } from "../../component/dialog-integration"
import { chooseOrg, chooseProject, chooseSpaces, launchStep, preselectProject, type Ask } from "./choose"
import { followDirectory } from "./follow"
import { t } from "./locale"

/**
 * Рабочий контекст Buff в терминальном интерфейсе (#391): виден всегда в строке состояния,
 * меняется командами /org, /project, /space (и из палитры), а в каталоге, где он ещё не
 * выбран, спрашивается сразу — угадывать проект по репозиторию нельзя.
 */

type Choice = BuffContext.Choice

export function ContextLabel(props: { context: Context; choice: Choice | null; signedOut?: boolean; own?: boolean }) {
  const theme = () => props.context.theme.text
  return (
    <Show
      when={props.choice}
      fallback={
        <Show
          when={!(props.signedOut && props.own)}
          fallback={
            <text fg={theme().muted} wrapMode="none">
              ◆ {t(BuffFirstRun.SIGNED_OUT_OWN)}
            </text>
          }
        >
          <text fg={theme().feedback.warning.base} wrapMode="none">
            ◆ {props.signedOut ? t(BuffFirstRun.SIGNED_OUT_SHORT) : `${BuffContext.label(null, t)} · /project`}
          </text>
        </Show>
      }
    >
      <text fg={theme().muted} wrapMode="none">
        ◆ {BuffContext.label(props.choice, t)}
      </text>
    </Show>
  )
}

type Step = "all" | "org" | "project" | "space"

function Commands(props: {
  context: Context
  choose: (step: Step) => Promise<void>
  /** Starts following other clients' switches; answers how to stop. */
  init: () => () => void
  load: (directory: string) => void
}) {
  const command = (step: Exclude<Step, "all">, title: string) => ({
    id: `buff.context.${step}`,
    title: t(title),
    group: "Buff",
    palette: true as const,
    slash: { name: step },
    run: () => void props.choose(step),
  })
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      command("org", "Buff: organization"),
      command("project", "Buff: project"),
      command("space", "Buff: knowledge spaces"),
    ],
  }))
  // The subscription ends with the interface: left open, it outlived the app and held the
  // server connection (a test server could not even stop).
  onMount(() => onCleanup(props.init()))
  followDirectory(() => props.context.location?.directory, props.load)
  return null
}

const message = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)
const failure = (error: unknown) => ({
  type: typeof error === "object" && error !== null && "type" in error ? String(error.type) : undefined,
  message: message(error),
})

export default Plugin.define({
  id: "buff.context",
  setup(context) {
    const rpc = context.client.rpc(BuffContext.Rpc)
    const at = () => ({ location: context.location })
    const [choice, setChoice] = createSignal<Choice | null>(null)
    // #457: без входа строка состояния говорит «нет модели — войдите в Buff».
    const [signedOut, setSignedOut] = createSignal(false)
    // Свой провайдер подключён (#562): без входа в Buff работа идёт, и вход сам не открывается.
    const [own, setOwn] = createSignal(false)
    const ownConnected = () =>
      context.client.model.list(at()).then(
        (response) => response.data.some(ownModel),
        () => false,
      )
    // #470: выбирать не из чего — сказать почему, а не открывать пустой список.
    const ask: Ask = async (dialog) => {
      if (dialog.options.length === 0 && dialog.empty) {
        context.ui.toast.show({ message: dialog.empty, variant: "warning" })
        return undefined
      }
      return context.ui.dialog.select(dialog)
    }

    const save = async (next: Choice) => {
      try {
        setChoice(await rpc.set(next, at()))
        context.ui.toast.show({
          message: t("Context: {org} › {project}", { org: next.org, project: next.project ?? t("no project") }),
          variant: "success",
        })
      } catch (error) {
        context.ui.toast.show({ message: message(error), variant: "error" })
      }
    }

    /** Весь путь или один шаг; каждый шаг начинается со свежего списка разрешённого. */
    const choose = async (step: Step) => {
      let options: BuffContext.Options
      try {
        options = await rpc.options(undefined, at())
      } catch (error) {
        context.ui.toast.show({ message: message(error), variant: "error" })
        return
      }
      const current = choice()
      if (step !== "all" && step !== "org" && !current) {
        context.ui.toast.show({ message: t("Choose an organization first: /org"), variant: "warning" })
        return
      }
      const org = step === "all" || step === "org" ? await chooseOrg(ask, options, current, t) : current!.org
      if (org === undefined) return
      const same = current?.org === org
      const project =
        step === "all" || step === "project"
          ? await chooseProject(ask, options, org, preselectProject(current, org), t)
          : same
            ? (current?.project ?? null)
            : null
      if (project === undefined) return
      const spaces =
        step === "all" || step === "space"
          ? await chooseSpaces(ask, options, org, same ? (current?.spaces ?? []) : [], t)
          : same
            ? [...(current?.spaces ?? [])]
            : []
      if (spaces === undefined) return
      await save({ org, project, spaces })
    }

    // Under a session's prompt; the home screen has its own footer line below (one label per
    // screen — under the home prompt it doubled the label and pushed the directory out).
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <Show when={input.sessionID}>
          <ContextLabel context={context} choice={choice()} signedOut={signedOut()} own={own()} />
        </Show>
      ),
    })
    context.ui.slot({
      append: "home.footer.status",
      render: () => <ContextLabel context={context} choice={choice()} signedOut={signedOut()} own={own()} />,
    })
    // Слой команд и первый вопрос живут в компоненте, отрисованном в приложении:
    // клавиатура и диалоги доступны только внутри него («Keymap.Provider is missing»).
    // Свой выбор каталога — как только каталог известен; чужие переключения (консоль,
    // десктоп) — по событию.
    // Вход в Buff — прямо здесь (#401): адрес коннектора, код для кабинета, ожидание; после
    // него сразу выбор организации и проекта. Отдельных команд для этого нет.
    const signIn = () =>
      context.ui.dialog.show(() => (
        <DialogIntegration
          integrationID="buff"
          autoConnect
          onConnected={() => {
            setSignedOut(false)
            context.ui.dialog.clear()
            void choose("all")
          }}
        />
      ))
    const load = () => {
      void (async () => {
        const saved = await rpc.get(undefined, at()).catch(() => null)
        setChoice(saved)
        const problem = await rpc.options(undefined, at()).then(() => undefined, failure)
        const step = launchStep(saved, problem)
        setSignedOut(step === "sign_in")
        if (step === "sign_in") {
          const connected = await ownConnected()
          setOwn(connected)
          return connected ? undefined : signIn()
        }
        if (step === "unreachable") return context.ui.toast.show({ message: problem!.message, variant: "error" })
        // Первый запуск в каталоге всегда спрашивает (#391).
        if (step === "choose") await choose("all")
      })().catch(() => undefined)
    }
    const init = () => {
      const abort = new AbortController()
      void (async () => {
        for await (const event of rpc.events.subscribe("changed", { signal: abort.signal })) {
          if (event.location?.directory !== context.location?.directory) continue
          setChoice(event.data as Choice)
        }
      })().catch(() => undefined)
      return () => abort.abort()
    }
    context.ui.slot({
      append: "app",
      render: () => <Commands context={context} choose={choose} init={init} load={load} />,
    })
  },
})
