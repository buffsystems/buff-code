// A session's goal in the window (#463), ported from the Solid window's buff/goal/controller.ts as
// a store: the goal of this session, its changes by the service's event, pause, resume, reset. A
// refusal of an action becomes a notice; reading is quiet — a server without goals has nothing to
// show, not a failure to report.

import type { BuffGoal } from "@opencode/schema/buff-goal"
import { createStore } from "../../core/store"

type Call<Output> = (input: { readonly session: string }) => Promise<Output>
type WithGoal = { readonly goal?: BuffGoal.Goal }

export interface GoalRpc {
  readonly get: Call<WithGoal>
  readonly pause: Call<WithGoal>
  readonly resume: Call<WithGoal>
  readonly clear: Call<object>
}

export interface GoalDeps {
  readonly rpc: GoalRpc
  readonly session: string
  readonly subscribe: (
    handler: (event: { readonly session: string; readonly goal?: BuffGoal.Goal }) => void,
  ) => () => void
  readonly notify: (text: string) => void
}

export function createGoalController(deps: GoalDeps) {
  const store = createStore<BuffGoal.Goal | undefined>(undefined)
  const act = (call: Call<WithGoal>) =>
    call({ session: deps.session }).then(
      (result) => store.set(() => result.goal),
      () => deps.notify("Failed — the service did not answer."),
    )
  return {
    store,
    /** Follow the service's changes of this session's goal; returns the stop. */
    start: () =>
      deps.subscribe((event) => {
        if (event.session === deps.session) store.set(() => event.goal)
      }),
    refresh: () =>
      deps.rpc.get({ session: deps.session }).then(
        (result) => store.set(() => result.goal),
        () => store.set(() => undefined),
      ),
    pause: () => act(deps.rpc.pause),
    resume: () => act(deps.rpc.resume),
    clear: () => act((input) => deps.rpc.clear(input).then(() => ({}))),
  }
}

export type GoalController = ReturnType<typeof createGoalController>
