// The branch button under the prompt (#454): the branch, how many files changed, how many commits
// are not pushed; it opens the Git dialog. Hidden outside git. Ported from the Solid window's
// buff/git-dialog.tsx BuffGitChip; the session composer mounts it.

import { BuffGit } from "@opencode/schema/buff-git"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { GitDialog } from "./dialog"
import { useGit } from "./use-git"
import "../bar.css"

export function BuffGitChip(props: { server: Server; directory: string; sessionID?: string }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const git = useGit(props.server, props.directory, props.sessionID)
  const state = useStore(git.state, (value) => value)
  if (!state) return null
  return (
    <button
      type="button"
      className="composer-chip buff-git-chip"
      data-component="buff-git-chip"
      title={`Git: ${BuffGit.syncLabel(state, t)}`}
      onClick={() => {
        void git.refresh()
        dialog.show((close) => <GitDialog git={git} onClose={close} />)
      }}
    >
      <span>⎇ {state.branch ?? "HEAD"}</span>
      {state.changes.length > 0 && (
        <span className="buff-git-chip__count" data-slot="changes">
          ±{state.changes.length}
        </span>
      )}
      {state.ahead > 0 && <span className="buff-git-chip__count">↑{state.ahead}</span>}
      {state.behind > 0 && <span className="buff-git-chip__count">↓{state.behind}</span>}
    </button>
  )
}
