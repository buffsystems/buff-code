import { createSignal } from "solid-js"
import type { BuffWorkflow } from "@opencode/schema/buff-workflow"
import type { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"

/**
 * Что делает страница сценариев (#448) — без отрисовки: сохранённые и прогоны, запуск с
 * аргументами, правка описания, удаление с подтверждением, остановка, продолжение, ответ
 * субагенту. Служба отвечает словами; отказ — уведомлением или строкой в форме.
 */

type Options = { readonly location?: { readonly directory: string } }
type Call<I, O> = (input: I, options?: Options) => Promise<O>
type Done = { readonly problem?: string }
export type Started = {
  readonly run?: string
  readonly session?: string
  readonly problem?: string
  readonly problems?: Readonly<Record<string, string>>
}

export interface Rpc {
  readonly list: Call<
    Record<string, never>,
    {
      readonly saved: readonly BuffWorkflowRpc.Saved[]
      readonly invalid: readonly { readonly path: string; readonly problem: string }[]
    }
  >
  readonly read: Call<
    { readonly name: string },
    { readonly meta: BuffWorkflowFile.Meta; readonly script: string; readonly path: string }
  >
  readonly saveMeta: Call<{ readonly name: string; readonly meta: BuffWorkflowFile.Meta }, Done>
  readonly remove: Call<{ readonly name: string }, { readonly removed: boolean }>
  readonly start: Call<
    { readonly name: string; readonly args: Record<string, unknown>; readonly directory: string },
    Started
  >
  readonly runs: Call<{ readonly workflow?: string }, { readonly runs: readonly BuffWorkflow.Run[] }>
  readonly run: Call<{ readonly id: string }, BuffWorkflowRpc.Detail>
  readonly stop: Call<{ readonly id: string }, { readonly stopped: boolean }>
  readonly resume: Call<{ readonly id: string }, Done>
  readonly answer: Call<{ readonly question: string; readonly text: string }, Done>
}

export interface Deps {
  readonly rpc: Rpc
  /** Каталог, через который идут вызовы: сценарии у пользователя, каталог нужен только для связи. */
  readonly directory: () => string | undefined
  readonly confirm: (ask: { readonly title: string; readonly description: string }) => Promise<boolean>
  readonly notify: (text: string) => void
  /** Перевод на язык окна: запасные тексты и слова службы. */
  readonly t: BuffI18n.T
}

const words = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback

export function createWorkflowsController(deps: Deps) {
  const { t } = deps
  const say = (error: unknown, fallback: string) => t(words(error, fallback))
  const [saved, setSaved] = createSignal<readonly BuffWorkflowRpc.Saved[]>([])
  const [invalid, setInvalid] = createSignal<readonly { readonly path: string; readonly problem: string }[]>([])
  const [runs, setRuns] = createSignal<readonly BuffWorkflow.Run[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const options = (): Options => {
    const directory = deps.directory()
    return directory ? { location: { directory } } : {}
  }

  const refresh = () =>
    Promise.all([deps.rpc.list({}, options()), deps.rpc.runs({}, options())]).then(
      ([list, history]) => {
        setSaved(list.saved)
        setInvalid(list.invalid)
        setRuns(history.runs)
        setLoaded(true)
      },
      (error: unknown) => deps.notify(say(error, "Workflows did not load.")),
    )
  /** Отказ запуска — на языке окна: общий и по аргументам. */
  const translated = (result: Started): Started => ({
    ...result,
    ...(result.problem ? { problem: t(result.problem) } : {}),
    ...(result.problems
      ? { problems: Object.fromEntries(Object.entries(result.problems).map(([name, text]) => [name, t(text)])) }
      : {}),
  })
  /** Действие, после которого списки перечитываются; отказ службы — уведомлением. */
  const act = <T extends object>(call: Promise<T>, fallback: string) =>
    call.then(
      (result) => {
        if ("problem" in result && typeof result.problem === "string") deps.notify(t(result.problem))
        return refresh().then(() => result)
      },
      (error: unknown) => {
        deps.notify(say(error, fallback))
        return undefined
      },
    )

  return {
    saved,
    invalid,
    runs,
    loaded,
    refresh,
    counts: () => ({
      saved: saved().length,
      runs: runs().length,
      running: runs().filter((run) => run.status === "running").length,
    }),
    read: (name: string) =>
      deps.rpc.read({ name }, options()).catch((error: unknown) => {
        deps.notify(say(error, "The workflow could not be read."))
        return undefined
      }),
    /** Описание и аргументы; отказ — словами, для строки в самом редакторе. */
    saveMeta: (name: string, meta: BuffWorkflowFile.Meta): Promise<string | undefined> =>
      deps.rpc.saveMeta({ name, meta }, options()).then(
        (result) => (result.problem ? t(result.problem) : refresh().then(() => undefined)),
        (error: unknown) => say(error, "The description was not saved."),
      ),
    remove: async (name: string) => {
      const yes = await deps.confirm({
        title: t("Delete workflow «{name}»?", { name }),
        description: t("The workflow file will be deleted. Past runs and their sessions stay."),
      })
      if (yes) await act(deps.rpc.remove({ name }, options()), "The workflow was not deleted.")
    },
    /** Запуск сохранённого в новой сессии проекта; ошибки аргументов — для полей формы. */
    start: (name: string, args: Record<string, unknown>, directory: string): Promise<Started> =>
      deps.rpc.start({ name, args, directory }, options()).then(
        (result) => (result.run ? refresh().then(() => result) : translated(result)),
        (error: unknown) => ({ problem: say(error, "The workflow did not start.") }),
      ),
    detail: (id: string) => deps.rpc.run({ id }, options()),
    stop: (id: string) => act(deps.rpc.stop({ id }, options()), "The run did not stop."),
    resume: (id: string) => act(deps.rpc.resume({ id }, options()), "The run did not resume."),
    answer: (question: string, text: string): Promise<string | undefined> =>
      deps.rpc.answer({ question, text }, options()).then(
        (result) => result.problem && t(result.problem),
        (error: unknown) => say(error, "The answer did not get through."),
      ),
  }
}

export type WorkflowsController = ReturnType<typeof createWorkflowsController>
