// Questions an agent asks above the composer (#584), ported from the Solid question dock: one
// question per tab with its options (one or several), an own answer typed in place, minimize to
// the question alone, Escape to dismiss and Mod+Enter to go on. Unsent answers survive a remount.

import { Button, IconButton, cx } from "@buff/ui/react"
import type { FormInfo } from "@opencode/client/promise"
import { Check, ChevronDown } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { useSession } from "../context"
import { DockPrompt } from "./dock"
import {
  answered,
  emptyQuestionState,
  formAnswer,
  pick,
  questionsOf,
  setCustom,
  setCustomOn,
  toggle,
  type QuestionState,
} from "./question-model"

const drafts = new Map<string, QuestionState>()

export function QuestionDock(props: { request: FormInfo; onSubmit(): void }) {
  const i18n = useI18n()
  const { server } = useSession()
  const key = JSON.stringify([server.key, props.request.id])
  const questions = useMemo(() => questionsOf(props.request), [props.request])
  const [state, setState] = useState<QuestionState>(() => drafts.get(key) ?? emptyQuestionState())
  const [editing, setEditing] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [sending, setSending] = useState(false)
  const replied = useRef(false)
  const options = useRef<HTMLButtonElement[]>([])
  const latest = useRef(state)
  latest.current = state

  // Unsent answers come back if the dock remounts (another tab, a reconnect).
  useEffect(
    () => () => {
      if (!replied.current) drafts.set(key, latest.current)
    },
    [key],
  )

  const question = questions[state.tab]
  const total = questions.length
  const multi = question?.multiple === true
  const last = state.tab >= total - 1
  const custom = state.custom[state.tab] ?? ""
  const customOn = state.customOn[state.tab] === true

  const focusOption = (index: number) => requestAnimationFrame(() => options.current[index]?.focus())
  const pickFocus = (tab: number) => {
    const list = questions[tab]?.options ?? []
    if (state.customOn[tab]) return list.length
    return Math.max(0, list.findIndex((item) => state.answers[tab]?.includes(item.value) ?? false))
  }
  useEffect(() => {
    focusOption(pickFocus(state.tab))
    // Focus the picked option once, when the dock appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (work: () => Promise<unknown>) => {
    if (sending) return
    setSending(true)
    props.onSubmit()
    void work()
      .then(() => {
        replied.current = true
        drafts.delete(key)
      })
      .catch((error: unknown) =>
        showToast({ title: i18n.t("common.requestFailed"), description: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => setSending(false))
  }
  const target = { sessionID: props.request.sessionID, formID: props.request.id }
  const submit = () => send(() => server.data.session.form.reply({ ...target, answer: formAnswer(questions, latest.current) }))
  const reject = () => send(() => server.data.session.form.cancel(target))

  const go = (tab: number) => {
    if (sending) return
    setState((current) => ({ ...current, tab }))
    setEditing(false)
    if (!minimized) focusOption(pickFocus(tab))
  }
  const next = () => {
    if (sending) return
    setEditing(false)
    if (last) return submit()
    go(state.tab + 1)
  }
  const select = (index: number) => {
    if (sending) return
    const option = question?.options[index]
    if (!option) return openCustom()
    setEditing(false)
    setState((current) => (multi ? toggle(current, option.value) : pick(current, option.value)))
  }
  const openCustom = () => {
    if (sending) return
    setEditing(true)
    setState((current) => setCustom(setCustomOn(current, true), current.custom[current.tab] ?? "", multi, true))
  }
  const toggleCustom = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!multi) return openCustom()
    if (!customOn) return openCustom()
    const value = custom.trim()
    setState((current) => {
      const off = setCustomOn(current, false)
      if (!value) return off
      const answers = [...off.answers]
      answers[off.tab] = (answers[off.tab] ?? []).filter((item) => item.trim() !== value)
      return { ...off, answers }
    })
    setEditing(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    if (event.key === "Escape") {
      event.preventDefault()
      return reject()
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter") {
      event.preventDefault()
      if (!event.repeat) next()
      return
    }
    if (editing || event.altKey || event.ctrlKey || event.metaKey) return
    if (!(event.target instanceof HTMLElement) || !event.target.closest('[data-slot="question-options"]')) return
    const count = (question?.options.length ?? 0) + 1
    const current = options.current.findIndex((element) => element === document.activeElement)
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (move !== undefined) {
      event.preventDefault()
      return focusOption(Math.max(0, Math.min(count - 1, current + move)))
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      focusOption(event.key === "Home" ? 0 : count - 1)
    }
  }

  return (
    <div data-component="session-question-dock">
      <DockPrompt
        kind="question"
        onKeyDown={onKeyDown}
        header={
          <>
            <div data-slot="question-header-title" className="dock-prompt__title">
              {i18n.t("session.question.progress", { current: Math.min(state.tab + 1, total), total })}
            </div>
            <div data-slot="question-header-actions" className="dock-prompt__actions">
              {total > 1 && (
                <div data-slot="question-progress" className="question-progress">
                  {questions.map((item, index) => (
                    <button
                      key={item.field.key}
                      type="button"
                      data-slot="question-progress-segment"
                      data-active={index === state.tab}
                      data-answered={answered(state, index)}
                      className="question-progress__segment"
                      disabled={sending}
                      onClick={() => go(index)}
                      aria-label={i18n.t("ui.tool.questions.numbered", { number: index + 1 })}
                    />
                  ))}
                </div>
              )}
              <IconButton
                icon={ChevronDown}
                size="xs"
                disabled={sending}
                className={cx("question-minimize", minimized && "question-minimize--restore")}
                onClick={() => {
                  setEditing(false)
                  setMinimized(!minimized)
                  if (minimized) focusOption(pickFocus(state.tab))
                }}
                aria-label={i18n.t(minimized ? "session.question.restore" : "session.question.minimize")}
              />
            </div>
          </>
        }
        footer={
          <>
            <Button variant="ghost" disabled={sending} onClick={reject} aria-keyshortcuts="Escape">
              {i18n.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions" className="dock-prompt__actions">
              {state.tab > 0 && (
                <Button variant="outline" disabled={sending} onClick={() => go(state.tab - 1)}>
                  {i18n.t("ui.common.back")}
                </Button>
              )}
              <Button variant={last ? "primary" : "outline"} disabled={sending} onClick={next} aria-keyshortcuts="Meta+Enter Control+Enter">
                {last ? i18n.t("ui.common.submit") : i18n.t("ui.common.next")}
              </Button>
            </div>
          </>
        }
      >
        <div data-slot="question-text" className={cx("question-text", minimized && "question-text--clamped")}>
          {question?.question}
        </div>
        {!minimized && (
          <div data-slot="question-hint" className="dock-prompt__hint">
            {multi ? i18n.t("ui.question.multiHint") : i18n.t("ui.question.singleHint")}
          </div>
        )}
        <div data-slot="question-options" className="question-options" hidden={minimized} aria-hidden={minimized || undefined}>
          {question?.options.map((option, index) => {
            const picked = state.answers[state.tab]?.includes(option.value) ?? false
            return (
              <button
                key={option.value}
                ref={(element) => {
                  if (element) options.current[index] = element
                }}
                type="button"
                data-slot="question-option"
                data-picked={picked}
                role={multi ? "checkbox" : "radio"}
                aria-checked={picked}
                disabled={sending}
                className="question-option"
                onClick={() => select(index)}
              >
                <Mark multi={multi} picked={picked} />
                <span className="question-option__main">
                  <span data-slot="option-label" className="question-option__label">
                    {option.label}
                  </span>
                  {option.description && (
                    <span data-slot="option-description" className="question-option__description">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
          {editing ? (
            <form
              data-slot="question-option"
              data-custom="true"
              data-picked={customOn}
              role={multi ? "checkbox" : "radio"}
              aria-checked={customOn}
              className="question-option"
              onSubmit={(event) => {
                event.preventDefault()
                setEditing(false)
                focusOption(question?.options.length ?? 0)
              }}
            >
              <Mark multi={multi} picked={customOn} onClick={toggleCustom} />
              <span className="question-option__main">
                <span data-slot="option-label" className="question-option__label">
                  {i18n.t("ui.messagePart.option.typeOwnAnswer")}
                </span>
                <textarea
                  autoFocus
                  data-slot="question-custom-input"
                  dir="auto"
                  rows={1}
                  className="question-option__input"
                  placeholder={i18n.t("ui.question.custom.placeholder")}
                  value={custom}
                  disabled={sending}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault()
                      setEditing(false)
                      return focusOption(question?.options.length ?? 0)
                    }
                    if ((event.metaKey || event.ctrlKey) && !event.altKey) return
                    if (event.key !== "Enter" || event.shiftKey) return
                    event.preventDefault()
                    setEditing(false)
                    focusOption(question?.options.length ?? 0)
                  }}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setState((current) => setCustom(current, value, multi))
                    event.currentTarget.style.height = "0px"
                    event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`
                  }}
                />
              </span>
            </form>
          ) : (
            <button
              ref={(element) => {
                if (element) options.current[question?.options.length ?? 0] = element
              }}
              type="button"
              data-slot="question-option"
              data-custom="true"
              data-picked={customOn}
              role={multi ? "checkbox" : "radio"}
              aria-checked={customOn}
              disabled={sending}
              className="question-option"
              onClick={openCustom}
            >
              <Mark multi={multi} picked={customOn} onClick={toggleCustom} />
              <span className="question-option__main">
                <span data-slot="option-label" className="question-option__label">
                  {i18n.t("ui.messagePart.option.typeOwnAnswer")}
                </span>
                <span data-slot="option-description" dir="auto" className="question-option__description">
                  {custom || i18n.t("ui.question.custom.placeholder")}
                </span>
              </span>
            </button>
          )}
        </div>
      </DockPrompt>
    </div>
  )
}

function Mark(props: { multi: boolean; picked: boolean; onClick?(event: MouseEvent): void }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true" className="question-mark" onClick={props.onClick}>
      <span
        data-slot="question-option-box"
        data-type={props.multi ? "checkbox" : "radio"}
        data-picked={props.picked}
        className={cx("question-mark__box", props.multi && "question-mark__box--multi")}
      >
        {props.multi ? props.picked && <Check aria-hidden /> : <span className="question-mark__dot" />}
      </span>
    </span>
  )
}
