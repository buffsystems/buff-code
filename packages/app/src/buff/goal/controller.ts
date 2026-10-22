import { createSignal, onCleanup } from "solid-js"
import type { BuffGoal } from "@opencode/schema/buff-goal"

/**
 * Цель сессии в окне (#463) без отрисовки: цель этой сессии, её изменения по событию службы,
 * пауза, продолжить, сбросить. Отказ службы — уведомлением.
 */

type Call<O> = (input: { readonly session: string }) => Promise<O>
type WithGoal = { readonly goal?: BuffGoal.Goal }
export interface Rpc {
  readonly get: Call<WithGoal>
  readonly pause: Call<WithGoal>
  readonly resume: Call<WithGoal>
  readonly clear: Call<object>
}

export interface Deps {
  readonly rpc: Rpc
  readonly session: () => string | undefined
  readonly subscribe: (
    handler: (event: { readonly session: string; readonly goal?: BuffGoal.Goal }) => void,
  ) => () => void
  readonly notify: (text: string) => void
}

export function createGoalController(deps: Deps) {
  const [goal, setGoal] = createSignal<BuffGoal.Goal | undefined>()
  const act = async (call: Call<WithGoal>) => {
    const session = deps.session()
    if (!session) return
    await call({ session }).then(
      (result) => setGoal(result.goal),
      () => deps.notify("Failed — the service did not answer."),
    )
  }
  onCleanup(
    deps.subscribe((event) => {
      if (event.session === deps.session()) setGoal(event.goal)
    }),
  )
  return {
    goal,
    refresh: () => act(deps.rpc.get),
    pause: () => act(deps.rpc.pause),
    resume: () => act(deps.rpc.resume),
    clear: () => act((input) => deps.rpc.clear(input).then(() => ({}))),
  }
}

export type GoalController = ReturnType<typeof createGoalController>
