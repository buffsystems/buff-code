// A side conversation as a tab of the side panel (#464): its trigger — the branch icon and the side
// session's title — and its panel. The Solid SessionSidePanel's «side:<id>» tab.

import { GitBranchPlus } from "lucide-react"
import type { ReactNode } from "react"
import { SideConversation } from "../../buff/side/side-conversation"
import { useMainQuote } from "../../buff/side/main-quote"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import type { SideController } from "./controller"
import { SortablePaneTab } from "./tabs"

export function SideConversationTabTrigger(props: {
  side: SideController
  tab: string
  session: string
  closeHint: ReactNode
}) {
  const t = useI18n().buff.t
  const { side, tab } = props
  const title = useServerData(side.session.server, (state) => state.session.info[props.session]?.title)
  return (
    <SortablePaneTab
      value={tab}
      index={side.stored.all.indexOf(tab)}
      selected={side.derived.activeTab === tab}
      onSelect={() => side.activate(tab)}
      onClose={() => side.close(tab)}
      closeHint={props.closeHint}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <GitBranchPlus aria-hidden className="size-4 shrink-0" />
        <span className="panes-tab-name max-w-40 truncate">{title ?? t("Side conversation")}</span>
      </span>
    </SortablePaneTab>
  )
}

export function SideConversationPanel(props: { side: SideController; session: string }) {
  const { session } = props.side
  const quote = useMainQuote()
  if (session.directory === undefined) return null
  return (
    <div role="tabpanel" data-slot="tabs-content" className="flex h-full flex-col overflow-hidden">
      <SideConversation
        key={props.session}
        server={session.server}
        session={props.session}
        main={session.sessionID}
        directory={session.directory}
        onQuote={quote}
      />
    </div>
  )
}
