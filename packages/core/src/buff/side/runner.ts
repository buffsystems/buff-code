export * as SideRunner from "./runner.js"

import { BuffSide } from "@opencode/schema/buff-side"
import { BuffLocale } from "../locale.js"

/**
 * Побочный диалог (#464) без службы: ответвление основной сессии, название по номеру, список у
 * основной и первый вопрос, если он задан. Ввод-вывод — через порты.
 */

export interface Deps {
  readonly store: {
    readonly get: (session: string) => Promise<readonly BuffSide.Side[]>
    readonly put: (session: string, sides: readonly BuffSide.Side[]) => Promise<void>
  }
  /** Ответвление сессии со всей историей; ответ — новая сессия. */
  readonly fork: (session: string) => Promise<string>
  readonly rename: (session: string, title: string) => Promise<void>
  readonly prompt: (session: string, text: string) => Promise<void>
  readonly now: () => number
}

export function make(deps: Deps) {
  return {
    list: (session: string) => deps.store.get(session),
    open: async (session: string, text?: string): Promise<BuffSide.Side> => {
      const sides = await deps.store.get(session)
      const side = { id: await deps.fork(session), n: BuffSide.next(sides), at: deps.now() }
      await deps.rename(side.id, BuffSide.title(side.n, BuffLocale.t))
      await deps.store.put(session, [...sides, side])
      if (text?.trim()) await deps.prompt(side.id, text.trim())
      return side
    },
  }
}
