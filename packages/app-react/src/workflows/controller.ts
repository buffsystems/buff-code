import type { BuffWorkflow } from "@opencode/schema/buff-workflow"
import type { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"

import { createStore } from "../core/store"

// What the workflows page does (#448), ported from the Solid window's buff/workflows/controller.ts
// as a store: saved workflows and runs, starting with arguments, editing the description, deleting
// after a yes, stopping, resuming, answering a subagent. The service answers in words; a refusal
// becomes a notice or a line in the form.

type Options = { readonly location?: { readonly directory: string } }
type Call<I, O> = (input: I, options?: Options) => Promise<O>
type Done = { readonly problem?: string }
export type Started = {
  readonly run?: string
  readonly session?: string
  readonly problem?: string
  readonly problems?: Readonly<Record<string, string>>
}

export interface WorkflowsRpc {
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

export interface WorkflowsDeps {
  readonly rpc: WorkflowsRpc
  /** The directory calls go through: workflows belong to the person, it only carries the connection. */
  readonly directory: () => string | undefined
  readonly confirm: (ask: { readonly title: string; readonly description: string }) => Promise<boolean>
  readonly notify: (text: string) => void
  /** The window's translator: fallback texts and the service's words. */
  readonly t: BuffI18n.T
}

const words = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback

export function createWorkflowsController(deps: WorkflowsDeps) {
  const t = deps.t
  const say = (error: unknown, fallback: string) => t(words(error, fallback))
  const store = createStore<WorkflowsState>({ saved: [], invalid: [], runs: [], loaded: false })
  const options = (): Options => {
    const directory = deps.directory()
    return directory ? { location: { directory } } : {}
  }

  const refresh = () =>
    Promise.all([deps.rpc.list({}, options()), deps.rpc.runs({}, options())]).then(
      ([list, history]) =>
        store.set(() => ({ saved: list.saved, invalid: list.invalid, runs: history.runs, loaded: true })),
      (error: unknown) => deps.notify(say(error, "Workflows did not load.")),
    )
  // A refused start in the window's language: the general reason and the ones per argument.
  const translated = (result: Started): Started => ({
    ...result,
    ...(result.problem ? { problem: t(result.problem) } : {}),
    ...(result.problems
      ? { problems: Object.fromEntries(Object.entries(result.problems).map(([name, text]) => [name, t(text)])) }
      : {}),
  })
  // An action after which the lists are read again; a refusal of the service becomes a notice.
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
    store,
    refresh,
    read: (name: string) =>
      deps.rpc.read({ name }, options()).catch((error: unknown) => {
        deps.notify(say(error, "The workflow could not be read."))
        return undefined
      }),
    /** The description and the arguments; a refusal comes back as words for the editor. */
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
    /** Start a saved workflow in a new session of the project; argument problems go to the form. */
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

export type WorkflowsState = {
  saved: readonly BuffWorkflowRpc.Saved[]
  invalid: readonly { readonly path: string; readonly problem: string }[]
  runs: readonly BuffWorkflow.Run[]
  loaded: boolean
}

export const workflowCounts = (state: WorkflowsState) => ({
  saved: state.saved.length,
  runs: state.runs.length,
  running: state.runs.filter((run) => run.status === "running").length,
})

export type WorkflowsController = ReturnType<typeof createWorkflowsController>
