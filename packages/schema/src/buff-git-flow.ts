export * as BuffGitFlow from "./buff-git-flow.js"

import { BuffGit } from "./buff-git.js"
import { BuffI18n } from "./buff-i18n.js"
import type { Ui } from "./buff-mcp-flow.js"

/**
 * Коммит и отправка из консоли (#454): что войдёт в коммит, сообщение (с заготовкой от модели),
 * отправлять ли сразу. Диалоги приходят снаружи; `undefined` — человек вышел из вопроса,
 * `problem` — делать нечего или ответ не годится. Строки — английские, `t`/`n` переводят (#472).
 */

export type Problem = { readonly problem: string }

export async function commit(
  ui: Ui,
  state: BuffGit.State,
  compose: (files: string[]) => Promise<string>,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): Promise<{ files: string[]; message: string; push: boolean } | Problem | undefined> {
  if (!state.changes.length) return { problem: t("The working copy is clean — nothing to commit.") }
  const files = state.changes.map((change) => change.file)
  const sure = await ui.confirm({
    title: n(files.length, "Commit {n} file?|Commit {n} files?"),
    message: state.changes.map((change) => `  ${BuffGit.changeLabel(change, t)}: ${change.file}`).join("\n"),
  })
  if (!sure) return undefined
  const draft = await compose(files).catch(() => "")
  const message = await ui.prompt({
    title: t("Commit message"),
    description: draft ? t("The model drafted it — edit if needed.") : t("What changed and why."),
    placeholder: t("fix: what changed and why"),
    value: draft,
  })
  if (message === undefined) return undefined
  const problem = BuffGit.commitProblem({ message, files }, t)
  if (problem) return { problem }
  const then = await ui.select<"keep" | "push">({
    title: t("Push to the server?"),
    options: [
      { title: t("Commit only"), value: "keep" },
      { title: t("Commit and push"), value: "push" },
    ],
  })
  return then ? { files, message: message.trim(), push: then === "push" } : undefined
}

export async function push(
  ui: Ui,
  state: BuffGit.State,
  t: BuffI18n.T = BuffI18n.english,
): Promise<true | Problem | undefined> {
  if (!state.branch) return { problem: t("HEAD is not on a branch — nothing to push.") }
  if (state.upstream && !state.ahead)
    return { problem: t("Nothing to push: the branch is {sync}.", { sync: BuffGit.syncLabel(state, t) }) }
  const sure = await ui.confirm({
    title: t("Push branch {branch}? ({sync})", { branch: state.branch, sync: BuffGit.syncLabel(state, t) }),
    message: state.upstream
      ? t("Commits go to {upstream}.", { upstream: state.upstream })
      : t("The branch will be created on the server (origin)."),
  })
  return sure ? true : undefined
}
