// «Add to message» beside a selection in a model answer (#459): the composer gets the chip «From the
// answer · N lines» and the model gets the fragment as a quote. Beside it, «To a side conversation»
// (#464): the fragment opens a new branch of the session. Ported from the Solid window's
// buff/answer-quote.tsx.

import { Button } from "@buff/ui/react"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useI18n } from "../i18n/provider"
import { showToast } from "../shell/notifications/toast"
import { answerSelection } from "./answer-selection"

const ANSWER = '[data-slot="session-turn-assistant-content"] [data-component="text-part"]'

export function BuffAnswerQuote(props: { onAdd?: (text: string) => void; onSide?: (text: string) => void }) {
  const t = useI18n().buff.t
  const [offer, setOffer] = useState<{ text: string; rect: DOMRect }>()
  useEffect(() => {
    const update = () => setOffer(answerSelection(window.getSelection(), ANSWER))
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [])
  if (!offer || (!props.onAdd && !props.onSide)) return null
  const take = (action: (text: string) => void) => {
    action(offer.text)
    window.getSelection()?.removeAllRanges()
  }
  return createPortal(
    <div
      className="buff-answer-quote fixed z-[60] flex gap-1"
      data-component="buff-answer-quote"
      style={{ top: Math.max(8, offer.rect.top - 40), left: Math.max(8, offer.rect.left) }}
    >
      {props.onAdd && (
        <Button
          size="sm"
          variant="primary"
          leadingIcon={Plus}
          data-action="buff-answer-quote"
          // The press must not drop the selection before it is taken.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const add = props.onAdd
            if (!add) return
            take(add)
            showToast({ title: t("Added to the message"), description: t("The answer fragment is in the input.") })
          }}
        >
          {t("Add to message")}
        </Button>
      )}
      {props.onSide && (
        <Button
          size="sm"
          data-action="buff-answer-side"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const side = props.onSide
            if (side) take(side)
          }}
        >
          {t("To a side conversation")}
        </Button>
      )}
    </div>,
    document.body,
  )
}
