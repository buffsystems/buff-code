import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { BuffQueryMap } from "@opencode/schema/buff-query-map"
import { Tooltip } from "@opencode/ui/tooltip"
import { useData } from "@/runtime/server/current"
import { useBuffText } from "./i18n"
import "./query-map.css"

/**
 * Карта запросов слева от ленты (#465), как в ZCode: риска на каждый запрос человека, текущий
 * выделен; при наведении — запрос и начало ответа; нажатие — переход к ходу. Показывается при
 * двух и более запросах и ленте шире 864 px. Список не режется: колонка прокручивается.
 */

const WIDE = 864
const gone: BuffQueryMap.Query = { id: "", index: 0, text: "", answer: "", running: false }

export function QueryMap(props: {
  session: string | undefined
  scroller: () => HTMLElement | undefined
  onJump: (id: string) => void
}) {
  const data = useData()
  const { t } = useBuffText()
  const messages = () => (props.session ? (data.session.message.list(props.session) ?? []) : [])
  const queries = createMemo(() => BuffQueryMap.queries(messages()))
  // Ticks are keyed by request, not by the query objects: streaming rebuilds those on every delta,
  // and a keyed <For> over them would remount every tick and its tooltip each time.
  const ids = createMemo(() => queries().map((query) => query.id), [], {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  })
  const byID = createMemo(() => new Map(queries().map((query) => [query.id, query])))
  const [current, setCurrent] = createSignal<string>()
  const [wide, setWide] = createSignal(false)

  // Текущий запрос — последний, чьё начало выше середины видимой ленты.
  const track = () => {
    const root = props.scroller()
    if (!root) return
    const box = root.getBoundingClientRect()
    setWide(box.width >= WIDE)
    const line = box.top + box.height / 2
    const passed = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].filter(
      (element) => element.getBoundingClientRect().top <= line,
    )
    setCurrent(passed.at(-1)?.dataset.messageId)
  }
  onMount(() => {
    const timer = setInterval(track, 400)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={wide() && BuffQueryMap.shown(messages())}>
      <nav class="buff-query-map" data-component="buff-query-map" aria-label={t("Request map")}>
        <For each={ids()}>
          {(id) => {
            // A row can outlive its request by one update: switching sessions recomputes the
            // queries (and these reads) before the list drops the previous session's rows.
            const query = () => byID().get(id) ?? gone
            const words = () => BuffQueryMap.preview(query(), t)
            return (
              <Tooltip
                placement="right"
                value={
                  <div class="buff-query-map-preview">
                    <span class="buff-query-map-title">{words().title}</span>
                    <span class="buff-query-map-query">{words().query}</span>
                    <span class="buff-query-map-answer">{words().answer}</span>
                  </div>
                }
              >
                <button
                  type="button"
                  class="buff-query-map-tick"
                  data-action="buff-query-jump"
                  data-active={current() === id || undefined}
                  data-running={query().running || undefined}
                  aria-label={t("Go to request {index}", { index: query().index })}
                  onClick={() => props.onJump(id)}
                />
              </Tooltip>
            )
          }}
        </For>
      </nav>
    </Show>
  )
}
