export * as BuffSnapshotGitPlugin from "./snapshot-git.js"

import { existsSync } from "node:fs"
import { Effect } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffSnapshotGit } from "@opencode/schema/buff-snapshot-git"
import { BuffGitBinary } from "./git-binary.js"

/**
 * Состояние git для снимков (#495) — окну и консоли, чтобы сказать человеку, почему откат и
 * изменения сессии не работают, вместо тихой потери снимка.
 */
/** Ответ rpc. Пустые поля не отдаём вовсе: ответ — JSON, а undefined в нём не значение. */
export function status(choice: BuffGitBinary.Choice, repository: boolean): BuffSnapshotGit.Status {
  const { snapshot, missing } = choice
  return {
    ready: snapshot !== undefined,
    repository,
    ...(missing ? { reason: missing.reason } : {}),
    ...(missing?.reason === "old" ? { version: missing.version } : {}),
  }
}

export const Plugin = define<Scope.Scope>({
  id: "buff.snapshot-git",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.rpc
      .register(BuffSnapshotGit.Rpc, {
        status: () =>
          Effect.sync(() =>
            status(BuffGitBinary.current(), BuffGitBinary.insideRepository(ctx.location.directory, existsSync)),
          ),
      })
      .pipe(Effect.orDie)
  }),
})
