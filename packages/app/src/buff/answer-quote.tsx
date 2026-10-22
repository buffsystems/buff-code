import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Button } from "@opencode/ui/button"
import { useComposerState } from "@/composer/persistence"
import { showToast } from "@/shell/notifications/toast"
import { chipPart } from "./attachment-prompt"
import { useBuffText } from "./i18n"
import "./answer-quote.css"

/**
 * «Добавить в сообщение» у выделенного в ответе модели (#459): рядом с выделением — кнопка,
 * в поле ввода ложится чип «Из ответа · N строк», модель получает фрагмент цитатой. Рядом —
 * «В побочный диалог» (#464): фрагмент уходит в новое ответвление сессии.
 */

const ANSWER = '[data-slot="session-turn-assistant-content"] [data-component="text-part"]'

/** Выделение целиком внутри одного ответа модели — его текст и где показать кнопку. */
export function answerSelection(
  selection: Selection | null,
  scope: string = ANSWER,
): { text: string; rect: DOMRect } | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined
  const inside = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest(scope)
  const start = inside(selection.anchorNode)
  if (!start || start !== inside(selection.focusNode)) return undefined
  const text = selection.toString().trim()
  if (!text) return undefined
  return { text, rect: selection.getRangeAt(0).getBoundingClientRect() }
}

/** onSide — второе действие: фрагмент уходит в новый побочный диалог (#464). */
export function BuffAnswerQuote(props: { onSide?: (text: string) => void }) {
  const prompt = useComposerState()
  const { t } = useBuffText()
  const [offer, setOffer] = createSignal<{ text: string; rect: DOMRect }>()
  onMount(() => {
    const update = () => setOffer(answerSelection(window.getSelection()))
    document.addEventListener("selectionchange", update)
    onCleanup(() => document.removeEventListener("selectionchange", update))
  })
  const add = () => {
    const current = offer()
    if (!current) return
    prompt.set([...prompt.current(), chipPart("quote", current.text, crypto.randomUUID())], prompt.cursor())
    window.getSelection()?.removeAllRanges()
    showToast({ title: t("Added to the message"), description: t("The answer fragment is in the input.") })
  }
  return (
    <Show when={offer()}>
      {(current) => (
        <Portal>
          <div
            class="buff-answer-quote"
            data-component="buff-answer-quote"
            style={{ top: `${Math.max(8, current().rect.top - 40)}px`, left: `${Math.max(8, current().rect.left)}px` }}
          >
            <Button
              size="small"
              variant="contrast"
              icon="plus"
              data-action="buff-answer-quote"
              // Нажатие не должно снимать выделение до того, как его заберут.
              onMouseDown={(event: MouseEvent) => event.preventDefault()}
              onClick={add}
            >
              {t("Add to message")}
            </Button>
            <Show when={props.onSide}>
              {(side) => (
                <Button
                  size="small"
                  variant="neutral"
                  data-action="buff-answer-side"
                  onMouseDown={(event: MouseEvent) => event.preventDefault()}
                  onClick={() => {
                    side()(current().text)
                    window.getSelection()?.removeAllRanges()
                  }}
                >
                  {t("To a side conversation")}
                </Button>
              )}
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  )
}
