// A quote into the main session's prompt (#459, #464): the chip «From the answer · N lines» at the
// end of the routed session's composer draft — what «Add to message» on a selected answer and
// «To the main conversation» in a side conversation put there.

import { chipPart } from "@opencode/app/react-reuse/attachment-prompt"
import { useCallback, useMemo } from "react"
import { useCore, useServerData } from "../../react/core"
import { useSession } from "../../session/context"
import { draftRegistry } from "../../session/composer/draft/registry"

export function useMainQuote(): ((text: string) => void) | undefined {
  const core = useCore()
  const { server, sessionID } = useSession()
  const directory = useServerData(server, (state) => state.session.info[sessionID]?.location.directory)
  const host = useMemo(() => ({ storage: core.platform.storage, draftStore: core.platform.draftStore }), [core.platform])
  const quote = useCallback(
    (text: string) => {
      if (directory === undefined) return
      const draft = draftRegistry(host).get({ type: "session", scope: core.scope(server.key), directory, sessionID })
      draft.set([...draft.current(), chipPart("quote", text, crypto.randomUUID())], draft.cursor())
    },
    [core, host, server.key, directory, sessionID],
  )
  return directory === undefined ? undefined : quote
}
