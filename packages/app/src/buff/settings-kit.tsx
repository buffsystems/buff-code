import { createSignal, For, Show, type JSX, type ParentProps } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { useBuffText } from "./i18n"
import "./settings-kit.css"

/**
 * Мелкие части экранов настроек Buff Code (#444, #445): подсказка под полем, выбор из
 * нескольких вариантов, строка отказа, окно подтверждения, окно проверки перед доверием
 * (#446). Одни на все экраны — чтобы они выглядели и вели себя одинаково.
 */

/** Содержимое окна-формы: поля столбиком с общими отступами. */
export function FormBody(props: ParentProps<{ name: string }>) {
  return (
    <div class="buff-kit-form" data-component={props.name}>
      {props.children}
    </div>
  )
}

export function Hint(props: ParentProps) {
  return <span class="buff-kit-hint">{props.children}</span>
}

export function Choice<Value extends string>(props: {
  value: Value
  options: readonly { readonly value: Value; readonly label: string }[]
  onPick: (value: Value) => void
  /** Вкладки разделов (окно Git) — с подчёркиванием, как в кабинете; по умолчанию — сегменты. */
  appearance?: "tabs"
}) {
  return (
    <div class="buff-kit-choice" data-appearance={props.appearance}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="buff-kit-choice-item"
            data-active={props.value === option.value}
            onClick={() => props.onPick(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

/** Почему не сохранилось — над кнопками, словами. */
export function Problem(props: { text: string | undefined }) {
  return (
    <Show when={props.text}>
      {(text) => (
        <div class="flex items-start gap-x-2 text-13-regular text-text-base" data-slot="buff-kit-problem">
          <Icon name="circle-ban-sign" class="mt-0.5 shrink-0 text-icon-critical-base" />
          <span>{text()}</span>
        </div>
      )}
    </Show>
  )
}

export function ConfirmDialog(props: { title: string; text: JSX.Element; confirm: string; onConfirm: () => void }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-kit-form">
          <span class="text-13-regular text-text-base">{props.text}</span>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button
          variant="danger"
          data-action="buff-kit-confirm"
          onClick={() => {
            props.onConfirm()
            dialog.close()
          }}
        >
          {props.confirm}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Подтверждение как ответ «да/нет»: закрыли окно — «нет». */
export function askConfirm(
  dialog: ReturnType<typeof useDialog>,
  ask: { readonly title: string; readonly text: string; readonly action: string },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let answered = false
    void dialog.show(
      () => (
        <ConfirmDialog
          title={ask.title}
          text={ask.text}
          confirm={ask.action}
          onConfirm={() => {
            answered = true
            resolve(true)
          }}
        />
      ),
      () => !answered && resolve(false),
    )
  })
}

/**
 * Проверка перед доверием (#446): человек видит ровно тот текст, который будет выполняться,
 * и подтверждает его. `onConfirm` возвращает причину отказа, если подтвердить не удалось.
 */
export function ReviewDialog(props: {
  title: string
  intro: string
  text: string
  onConfirm: () => Promise<string | undefined>
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const [problem, setProblem] = createSignal<string>()
  const confirm = async () => {
    const refusal = await props.onConfirm()
    if (refusal) return setProblem(refusal)
    dialog.close()
  }
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-kit-form" data-component="buff-kit-review">
          <span class="text-13-regular text-text-base">{props.intro}</span>
          <pre class="buff-kit-review-text">{props.text}</pre>
          <Problem text={problem()} />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-kit-trust" onClick={() => void confirm()}>
          {t("Trust")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
