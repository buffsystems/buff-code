// The strip above the composer after a rewind (#449): what came back, and «Bring it back».

import { Button } from "@buff/ui/react"
import { BuffTurn } from "@opencode/schema/buff-turn"
import { ArrowLeft } from "lucide-react"
import { useI18n } from "../../../i18n/provider"
import { useServerData } from "../../../react/core"
import type { BuffScope } from "./scope"
import "../../../buff/bar.css"
import "./buff.css"

export function RevertedStrip(props: { scope: BuffScope; onRedo(): void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const revert = useServerData(props.scope.server, (state) =>
    props.scope.sessionID ? state.session.info[props.scope.sessionID]?.revert : undefined,
  )
  if (!revert) return null
  return (
    <div className="buff-bar" data-component="buff-turn-reverted">
      <ArrowLeft aria-hidden className="buff-bar__icon" />
      <span className="buff-bar__text">
        {BuffTurn.revertedLine(revert.files?.length ?? 0, t, i18n.buff.n)} {t("Send a new message and the rewind becomes final.")}
      </span>
      <Button size="sm" variant="outline" data-action="buff-turn-redo" onClick={props.onRedo}>
        {t("Bring it back")}
      </Button>
    </div>
  )
}
