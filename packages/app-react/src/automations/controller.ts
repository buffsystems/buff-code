// What the automations page does (#447), ported from the Solid window's buff/automations/
// controller.ts as a store: the list with a filter, running by hand, pausing, stopping and deleting
// after a yes. The service answers in words; a refusal becomes a notice. Words go through the
// window's translator (#472).

import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { createStore } from "../core/store"

type Options = { readonly location?: { readonly directory: string } }
type Call<Input, Output> = (input: Input, options?: Options) => Promise<Output>
type Saved = { readonly automation?: BuffAutomation.Automation; readonly problem?: string }

export interface AutomationsRpc {
  readonly list: Call<Record<string, never>, { readonly automations: readonly BuffAutomation.Automation[] }>
  readonly save: Call<{ readonly id?: string; readonly draft: BuffAutomation.Draft }, Saved>
  readonly remove: Call<{ readonly id: string }, { readonly removed: boolean }>
  readonly pause: Call<{ readonly id: string; readonly paused: boolean }, Saved>
  readonly run: Call<{ readonly id: string }, { readonly run?: BuffAutomation.Run; readonly problem?: string }>
  readonly stop: Call<{ readonly id: string }, { readonly stopped: boolean }>
  readonly runs: Call<{ readonly id: string }, { readonly runs: readonly BuffAutomation.Run[] }>
  readonly removeRun: Call<{ readonly id: string; readonly run: string }, { readonly removed: boolean }>
}

export interface AutomationsDeps {
  readonly rpc: AutomationsRpc
  /** The directory calls go through: automations are shared, it only carries the connection. */
  readonly directory: () => string | undefined
  readonly confirm: (ask: { readonly title: string; readonly description: string }) => Promise<boolean>
  readonly notify: (text: string) => void
  readonly t?: BuffI18n.T
}

export type AutomationsState = {
  items: readonly BuffAutomation.Automation[]
  loaded: boolean
  filter: BuffAutomation.Filter
}

export function countAutomations(items: readonly BuffAutomation.Automation[]) {
  const result: Record<BuffAutomation.Filter, number> = { all: 0, running: 0, waiting: 0, failed: 0, paused: 0 }
  items.forEach((item) =>
    BuffAutomation.FILTERS.forEach((entry) => {
      if (BuffAutomation.matches(entry.value, item)) result[entry.value]++
    }),
  )
  return result
}

export const visibleAutomations = (state: AutomationsState) =>
  state.items.filter((item) => BuffAutomation.matches(state.filter, item))

export function createAutomationsController(deps: AutomationsDeps) {
  const t = deps.t ?? BuffI18n.english
  const store = createStore<AutomationsState>({ items: [], loaded: false, filter: "all" })
  const words = (error: unknown, fallback: string) =>
    t(
      typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : fallback,
    )
  const options = (): Options => {
    const directory = deps.directory()
    return directory ? { location: { directory } } : {}
  }
  const title = (id: string) => store.get().items.find((item) => item.id === id)?.title ?? ""

  const refresh = () =>
    deps.rpc.list({}, options()).then(
      (result) => store.set((state) => ({ ...state, items: result.automations, loaded: true })),
      (error: unknown) => deps.notify(words(error, "The automation list did not load.")),
    )
  // An action after which the list is read again; a refusal of the service becomes a notice.
  const act = <Result extends object>(call: Promise<Result>, fallback: string) =>
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

  return {
    store,
    setFilter: (filter: BuffAutomation.Filter) => store.set((state) => ({ ...state, filter })),
    refresh,
    /** Save; a refusal comes back as words for the editor's own line (no notice). */
    save: (id: string | undefined, draft: BuffAutomation.Draft): Promise<string | undefined> =>
      deps.rpc.save({ ...(id ? { id } : {}), draft }, options()).then(
        (result) => (result.problem ? t(result.problem) : refresh().then(() => undefined)),
        (error: unknown) => words(error, "The automation was not saved."),
      ),
    runNow: (id: string) => act(deps.rpc.run({ id }, options()), "The run did not start."),
    stop: (id: string) => act(deps.rpc.stop({ id }, options()), "The automation run did not stop."),
    pause: (id: string, paused: boolean) => act(deps.rpc.pause({ id, paused }, options()), "It did not work."),
    async remove(id: string) {
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
