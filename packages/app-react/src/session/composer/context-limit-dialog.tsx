// Свой размер окна контекста (#836): диалог с одним полем — число токенов (150000, 150k, 1.5M)
// в пределах окна модели; ответ — число или ничего.

import { Button, Dialog, DialogBody, DialogFooter, Field, Input } from "@buff/ui/react"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { useState } from "react"
import type { DialogStack } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"

export function askContextLimit(dialog: DialogStack, input: { initial: number; max?: number }) {
  return new Promise<number | undefined>((resolve) => {
    dialog.show((close) => (
      <ContextLimitDialog
        initial={input.initial}
        max={input.max}
        onDone={(value) => {
          close()
          resolve(value)
        }}
      />
    ))
  })
}

function ContextLimitDialog(props: { initial: number; max?: number; onDone(value: number | undefined): void }) {
  const t = useI18n().buff.t
  const [text, setText] = useState(props.initial ? String(props.initial) : "")
  const value = BuffContextWindow.parseCustom(text, props.max)
  const range = t("From {min} to {max}", {
    min: BuffContextWindow.format(BuffContextWindow.MIN_CUSTOM),
    max: props.max ? BuffContextWindow.format(props.max) : "∞",
  })
  const submit = () => {
    if (value !== undefined) props.onDone(value)
  }
  return (
    <Dialog
      open
      size="sm"
      title={t(BuffContextWindow.TITLE)}
      description={t("A size of your own, in tokens")}
      onOpenChange={(open) => !open && props.onDone(undefined)}
    >
      <DialogBody>
        <Field label={t("Context limit in tokens")} hint={range} error={text && value === undefined ? range : undefined}>
          <Input
            autoFocus
            inputMode="numeric"
            value={text}
            placeholder="200000"
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit()
            }}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onDone(undefined)}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" disabled={value === undefined} onClick={submit}>
          {t("Apply")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
