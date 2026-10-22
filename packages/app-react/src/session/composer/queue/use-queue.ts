// The session queue as the composer screen holds it (#584): one queue per session, reading the
// latest running state and follow-up preference, focusing the editor after an edit swaps the draft.

import { setCursorPosition } from "@opencode/app/react-reuse/composer-dom"
import { useEffect, useMemo, useRef, type RefObject } from "react"
import type { Server } from "../../../core/servers"
import { useI18n } from "../../../i18n/provider"
import { showToast } from "../../../shell/notifications/toast"
import type { ComposerDraft } from "../draft/draft"
import type { ComposerDelivery } from "../editor/controller"
import { createSessionQueue, type SessionQueue } from "./queue"

export function useSessionQueue(input: {
  server: Server
  sessionID: string
  directory: string
  draft: ComposerDraft
  working: boolean
  behavior: ComposerDelivery
  editor: RefObject<HTMLElement | undefined>
}): SessionQueue {
  const i18n = useI18n()
  const latest = useRef(input)
  latest.current = input
  const queue = useMemo(
    () =>
      createSessionQueue({
        server: input.server,
        sessionID: input.sessionID,
        draft: input.draft,
        directory: () => latest.current.directory,
        working: () => latest.current.working,
        behavior: () => latest.current.behavior,
        notify: () => showToast({ title: i18n.t("common.requestFailed") }),
        restoreFocus: (cursor) =>
          requestAnimationFrame(() => {
            const editor = latest.current.editor.current
            if (!editor) return
            editor.focus()
            setCursorPosition(editor, cursor)
          }),
      }),
    // One queue per session and draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.server, input.sessionID, input.draft],
  )
  useEffect(() => () => queue.dispose(), [queue])
  // The queue reads the session's inbox; load it once for this session.
  useEffect(() => {
    void input.server.data.session.pending.sync(input.sessionID).catch(() => undefined)
  }, [input.server, input.sessionID])
  return queue
}
