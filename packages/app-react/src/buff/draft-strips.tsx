// Buff's pieces on the new-session draft (#584), as the Solid draft view shows them, for the
// draft's server and directory: «no model» (#457) and a git too old for snapshots (#495) above the
// composer, the working context (#391) after the project and the organization's balance (#455) at
// the end of the project row.

import { useDraft } from "../new-session/context"
import { BuffBalanceChip } from "./billing/billing"
import { BuffContextChip } from "./context/chip"
import { BuffNoModelStrip } from "./no-model/strip"
import { BuffSnapshotGitStrip } from "./snapshot-git/strip"
import "./bar.css"

export function DraftStrips() {
  const draft = useDraft()
  return (
    <div className="buff-bars">
      <BuffNoModelStrip server={draft.server} directory={draft.directory} />
      <BuffSnapshotGitStrip server={draft.server} directory={draft.directory} />
    </div>
  )
}

export function DraftChips() {
  const draft = useDraft()
  return (
    <>
      <BuffContextChip server={draft.server} directory={draft.directory} />
    </>
  )
}

export function DraftBalance() {
  const draft = useDraft()
  return <BuffBalanceChip server={draft.server} directory={draft.directory} />
}
