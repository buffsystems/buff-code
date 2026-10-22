// The way into side conversations on the session screen (#464): the palette command, the service's
// «opened» event (`/side`) and «To a side conversation» on a selected answer open the side
// conversation as a tab of the side panel; «Add to message» quotes the selection into the prompt.
// The Solid session screen's useSideConversations + BuffAnswerQuote.

import { sessionSideTab } from "@opencode/app/react-reuse/session-tabs"
import { BuffAnswerQuote } from "../../buff/answer-quote"
import { useMainQuote } from "../../buff/side/main-quote"
import { useSideConversations } from "../../buff/side/use-side"
import { useSessionViewNow } from "../context"
import { usePaneSession } from "../panes/session"

export function SideEntry() {
  const session = usePaneSession()
  const view = useSessionViewNow()
  const quote = useMainQuote()
  const { window, sessionKey } = session
  const side = useSideConversations({
    server: session.server,
    main: session.sessionID,
    directory: session.directory ?? "",
    show: (id) => {
      if (!sessionKey) return
      window.layout.tabs(sessionKey).open(sessionSideTab(id))
      view.openReview()
    },
  })
  return <BuffAnswerQuote onAdd={quote} onSide={session.directory === undefined ? undefined : side.fromSelection} />
}
