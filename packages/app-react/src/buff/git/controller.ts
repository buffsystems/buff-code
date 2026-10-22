// Git in the window (#454) without the drawing, ported from the Solid window's buff/git-dialog.tsx:
// the working copy's state (absent outside git), switching and creating branches, committing,
// pushing, composing a message and reading the history. Git's refusals come back as words.

import type { BuffGit } from "@opencode/schema/buff-git"
import { createStore } from "../../core/store"

export const LOG_PAGE = 100

type Options = { readonly location: { readonly directory: string } }

export interface GitRpc {
  readonly state: (input: undefined, options: Options) => Promise<BuffGit.State>
  readonly branches: (input: undefined, options: Options) => Promise<readonly string[]>
  readonly switch: (input: { branch: string; create?: boolean }, options: Options) => Promise<BuffGit.State>
  readonly commit: (input: { message: string; files: string[] }, options: Options) => Promise<BuffGit.State>
  readonly push: (input: undefined, options: Options) => Promise<BuffGit.State>
  readonly message: (input: { files: string[]; sessionID?: string }, options: Options) => Promise<{ message: string }>
  readonly log: (input: { skip: number; count: number }, options: Options) => Promise<readonly BuffGit.Commit[]>
}

export function createGitController(input: {
  rpc: GitRpc
  directory: string
  sessionID?: string
  /** A refusal in words (the server's error formatted for the person). */
  refusal: (error: unknown) => string
}) {
  const at = { location: { directory: input.directory } }
  const state = createStore<BuffGit.State | undefined>(undefined)
  const run = (action: Promise<BuffGit.State>) =>
    action.then(
      (next) => {
        state.set(() => next)
        return undefined
      },
      (error: unknown) => input.refusal(error),
    )
  return {
    state,
    /** Read the state again; outside git there is none, and the chip hides. */
    refresh: () =>
      input.rpc.state(undefined, at).then(
        (next) => state.set(() => next),
        () => state.set(() => undefined),
      ),
    branches: () => input.rpc.branches(undefined, at),
    switch: (branch: string, create?: boolean) => run(input.rpc.switch({ branch, ...(create ? { create } : {}) }, at)),
    commit: (message: string, files: string[]) => run(input.rpc.commit({ message, files }, at)),
    push: () => run(input.rpc.push(undefined, at)),
    message: (files: string[]) =>
      input.rpc
        .message({ files, ...(input.sessionID ? { sessionID: input.sessionID } : {}) }, at)
        .then((result) => result.message),
    log: (skip: number) => input.rpc.log({ skip, count: LOG_PAGE }, at),
  }
}

export type GitController = ReturnType<typeof createGitController>
