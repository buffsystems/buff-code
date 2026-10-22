import { createSignal } from "solid-js"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffI18n } from "@opencode/schema/buff-i18n"

/**
 * Что делает страница автоматизаций (#447) — без отрисовки: список с фильтром, запуск вручную,
 * пауза, остановка и удаление с подтверждением. Служба отвечает словами; отказ — уведомлением.
 * Слова службы и свои — через переводчика окна (#472).
 */

type Options = { readonly location?: { readonly directory: string } }
type Call<I, O> = (input: I, options?: Options) => Promise<O>
type Saved = { readonly automation?: BuffAutomation.Automation; readonly problem?: string }

export interface Rpc {
  readonly list: Call<Record<string, never>, { readonly automations: readonly BuffAutomation.Automation[] }>
  readonly save: Call<{ readonly id?: string; readonly draft: BuffAutomation.Draft }, Saved>
  readonly remove: Call<{ readonly id: string }, { readonly removed: boolean }>
  readonly pause: Call<{ readonly id: string; readonly paused: boolean }, Saved>
  readonly run: Call<{ readonly id: string }, { readonly run?: BuffAutomation.Run; readonly problem?: string }>
  readonly stop: Call<{ readonly id: string }, { readonly stopped: boolean }>
  readonly runs: Call<{ readonly id: string }, { readonly runs: readonly BuffAutomation.Run[] }>
  readonly removeRun: Call<{ readonly id: string; readonly run: string }, { readonly removed: boolean }>
}

export interface Deps {
  readonly rpc: Rpc
  /** Каталог, через который идут вызовы: автоматизации общие, каталог нужен только для связи. */
  readonly directory: () => string | undefined
  readonly confirm: (ask: { readonly title: string; readonly description: string }) => Promise<boolean>
  readonly notify: (text: string) => void
  /** Переводчик окна; без него — английские исходные строки. */
  readonly t?: BuffI18n.T
}

export function createAutomationsController(deps: Deps) {
  const t = deps.t ?? BuffI18n.english
  const words = (error: unknown, fallback: string) =>
    t(
      typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : fallback,
    )
  const [items, setItems] = createSignal<readonly BuffAutomation.Automation[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [filter, setFilter] = createSignal<BuffAutomation.Filter>("all")
  const options = (): Options => {
    const directory = deps.directory()
    return directory ? { location: { directory } } : {}
  }
  const title = (id: string) => items().find((item) => item.id === id)?.title ?? ""

  const refresh = () =>
    deps.rpc.list({}, options()).then(
      (result) => {
        setItems(result.automations)
        setLoaded(true)
      },
      (error: unknown) => deps.notify(words(error, "The automation list did not load.")),
    )
  /** Действие, после которого список перечитывается; отказ службы — уведомлением. */
  const act = <T extends object>(call: Promise<T>, fallback: string) =>
    call.then(
      (result) => {
        if ("problem" in result && typeof result.problem === "string") deps.notify(t(result.problem))
        return refresh().then(() => result)
      },
      (error: unknown) => {
        deps.notify(words(error, fallback))
        return undefined
      },
    )

  const counts = () => {
    const result: Record<BuffAutomation.Filter, number> = { all: 0, running: 0, waiting: 0, failed: 0, paused: 0 }
    for (const item of items())
      for (const entry of BuffAutomation.FILTERS) if (BuffAutomation.matches(entry.value, item)) result[entry.value]++
    return result
  }

  return {
    items,
    loaded,
    filter,
    setFilter,
    counts,
    visible: () => items().filter((item) => BuffAutomation.matches(filter(), item)),
    refresh,
    /** Сохранить; отказ — словами, для строки в самом редакторе (без уведомления). */
    save: (id: string | undefined, draft: BuffAutomation.Draft): Promise<string | undefined> =>
      deps.rpc.save({ ...(id ? { id } : {}), draft }, options()).then(
        (result) => (result.problem ? t(result.problem) : refresh().then(() => undefined)),
        (error: unknown) => words(error, "The automation was not saved."),
      ),
    runNow: (id: string) => act(deps.rpc.run({ id }, options()), "The run did not start."),
    stop: (id: string) => act(deps.rpc.stop({ id }, options()), "The automation run did not stop."),
    pause: (id: string, paused: boolean) => act(deps.rpc.pause({ id, paused }, options()), "It did not work."),
    remove: async (id: string) => {
      const yes = await deps.confirm({
        title: t("Delete the automation «{title}»?", { title: title(id) }),
        description: t("It will no longer run, its run history will be deleted. The run sessions will stay."),
      })
      if (yes) await act(deps.rpc.remove({ id }, options()), "The automation was not deleted.")
    },
    runs: (id: string) => deps.rpc.runs({ id }, options()).then((result) => result.runs),
    removeRun: (id: string, run: string) =>
      act(deps.rpc.removeRun({ id, run }, options()), "The record was not deleted."),
  }
}

export type AutomationsController = ReturnType<typeof createAutomationsController>
