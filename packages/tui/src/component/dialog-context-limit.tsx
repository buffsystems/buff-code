// Окно контекста (#837, эпик #783): диалог /context — максимум модели, пресеты в пределах окна
// модели, действующий лимит, свой размер числом. Слова — те же, что в окне (BuffContextWindow).
import { createMemo } from "solid-js"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { useLocal } from "../context/local"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { t } from "../feature-plugins/buff/locale"

/** The dialog as a view: the choices for a model window and the cap in force; a pick reports tokens. */
export function DialogContextLimitView(props: {
  modelWindow: number | undefined
  /** The window is a fallback nobody named (#898). */
  assumed?: boolean
  current: number
  onSelect: (tokens: number) => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const options = createMemo(() =>
    BuffContextWindow.options(props.modelWindow, props.current, t, props.assumed === true).map((option) => ({
      value: option.id,
      title: option.label,
      description: option.hint,
      onSelect: () => {
        if (option.id !== BuffContextWindow.CUSTOM) {
          dialog.clear()
          const tokens = BuffContextWindow.parse(option.id)
          if (tokens !== undefined) props.onSelect(tokens)
          return
        }
        dialog.replace(() => (
          <DialogPrompt
            title={t("Context limit in tokens")}
            placeholder={props.current ? String(props.current) : "200000"}
            onConfirm={(value) => {
              const tokens = BuffContextWindow.parseCustom(value, props.modelWindow)
              if (tokens === undefined)
                return toast.show({
                  title: t("Context limit in tokens"),
                  message: t("From {min} to {max}", {
                    min: BuffContextWindow.format(BuffContextWindow.MIN_CUSTOM),
                    max: props.modelWindow ? BuffContextWindow.format(props.modelWindow) : "∞",
                  }),
                  variant: "error",
                })
              dialog.clear()
              props.onSelect(tokens)
            }}
          />
        ))
      },
    })),
  )
  return (
    <DialogSelect<string>
      options={options()}
      title={t("Select context window")}
      current={props.current ? String(props.current) : "0"}
      flat={true}
    />
  )
}

/** The dialog wired to the console's state: the session's cap, or the next session's draft. */
export function DialogContextLimit() {
  const local = useLocal()
  return (
    <DialogContextLimitView
      modelWindow={local.contextLimit.modelWindow()}
      assumed={local.contextLimit.modelWindowAssumed()}
      current={local.contextLimit.current()}
      onSelect={(tokens) => local.contextLimit.set(tokens)}
    />
  )
}
