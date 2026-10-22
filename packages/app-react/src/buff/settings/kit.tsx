// The small parts Buff Code's settings pages share (#444, #445), ported from the Solid window's
// settings-kit.tsx onto @buff/ui: a hint under a field, a choice of a few options, the reason a save
// failed, a form dialog and the review before trusting a text that will run (#446).

import { Button, Dialog, DialogBody, DialogFooter, Segmented } from "@buff/ui/react"
import { CircleAlert } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useI18n } from "../../i18n/provider"

export function Hint(props: { children?: ReactNode }) {
  return <span className="ui-hint">{props.children}</span>
}

export function Choice<Value extends string>(props: {
  value: Value
  options: readonly { readonly value: Value; readonly label: string }[]
  label?: string
  onPick: (value: Value) => void
}) {
  return (
    <Segmented
      size="sm"
      label={props.label}
      value={props.value}
      options={props.options.map((option) => ({ id: option.value, label: option.label }))}
      onChange={props.onPick}
      className="self-start"
    />
  )
}

/** Why it did not save — above the buttons, in words. */
export function Problem(props: { text?: string }) {
  if (!props.text) return null
  return (
    <div className="flex items-start gap-2 text-sm" role="alert" data-slot="buff-kit-problem">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>{props.text}</span>
    </div>
  )
}

/** A dialog holding a form: fields in a column, Cancel and the primary action under them. */
export function FormDialog(props: {
  title: string
  name: string
  action: string
  actionTarget?: string
  busy?: boolean
  size?: "md" | "lg"
  onClose: () => void
  onSubmit: () => void
  children?: ReactNode
}) {
  const i18n = useI18n()
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={props.title}
      size={props.size ?? "lg"}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-3" data-component={props.name}>
          {props.children}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={props.onClose}>{i18n.buff.t("Cancel")}</Button>
        <Button variant="primary" data-action={props.actionTarget} disabled={props.busy} onClick={props.onSubmit}>
          {props.action}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The check before trusting (#446): the person sees exactly the text that will run and confirms
 * it. `onConfirm` resolves the reason it could not be trusted, if any. The hooks and commands
 * settings and the trust strip above the composer use it.
 */
export function ReviewDialog(props: {
  title: string
  intro: string
  text: string
  onClose: () => void
  onConfirm: () => Promise<string | undefined>
}) {
  const i18n = useI18n()
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    const refusal = await props.onConfirm()
    setBusy(false)
    if (refusal) return setProblem(refusal)
    props.onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={props.title}
      size="lg"
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-3" data-component="buff-kit-review">
          <span className="text-sm">{props.intro}</span>
          <pre className="ui-code-block">{props.text}</pre>
          <Problem text={problem} />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={props.onClose}>{i18n.buff.t("Cancel")}</Button>
        <Button variant="primary" loading={busy} data-action="buff-kit-trust" onClick={() => void confirm()}>
          {i18n.buff.t("Trust")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
