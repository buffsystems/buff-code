// The toast stack (#584), drawn with the design system's toast look; the Solid window's test
// hooks (toast-v2-<id>, its slots) stay so the e2e specs find toasts.

import { Button } from "@buff/ui/react"
import { AlertCircle, CheckCircle2, LoaderCircle, X, type LucideIcon } from "lucide-react"
import { createPortal } from "react-dom"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { dismissToast, toasts, type Toast, type ToastVariant } from "./toast"

const ICON: Record<ToastVariant, LucideIcon | undefined> = {
  default: undefined,
  success: CheckCircle2,
  error: AlertCircle,
  loading: LoaderCircle,
}

export function ToastRegion() {
  const list = useStore(toasts, (items) => items)
  if (list.length === 0) return null
  return createPortal(
    // A list of toasts, as the Solid window's toaster: each one is a list item.
    <div data-component="toast-region" role="status" aria-live="polite">
      <ol className="ui-toaster m-0 list-none p-0">
        {list.map((item) => (
          <ToastItem key={item.id} toast={item} />
        ))}
      </ol>
    </div>,
    document.body,
  )
}

function ToastItem(props: { toast: Toast }) {
  const i18n = useI18n()
  const toast = props.toast
  const variant = toast.variant ?? "default"
  const Icon = toast.icon === false ? undefined : (ICON[variant] ?? (toast.icon ? CheckCircle2 : undefined))
  return (
    <li
      data-testid={`toast-v2-${toast.id}`}
      data-component="toast-v2"
      data-variant={variant}
      data-pulse={toast.pulse}
      className={`ui-toast ui-toast--${variant === "error" ? "error" : variant === "success" ? "success" : "info"}`}
    >
      {Icon && (
        <div data-slot="toast-v2-icon" className="ui-toast__icon">
          <Icon data-slot="icon-svg" aria-hidden className={variant === "loading" ? "ui-spinner" : undefined} />
        </div>
      )}
      <div data-slot="toast-v2-content" className="ui-toast__message flex min-w-0 flex-col gap-0.5">
        {toast.title && (
          <div data-slot="toast-v2-title" className="font-medium">
            {toast.title}
          </div>
        )}
        {toast.description && <div data-slot="toast-v2-description">{toast.description}</div>}
        {toast.actions && toast.actions.length > 0 && (
          <div data-slot="toast-v2-actions" className="mt-1.5 flex gap-2">
            {toast.actions.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={action.onClick === "dismiss" ? "outline" : "primary"}
                onClick={() => {
                  if (action.onClick !== "dismiss") action.onClick()
                  dismissToast(toast.id)
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        data-slot="toast-v2-close-button"
        className="ui-toast__close"
        aria-label={i18n.t("common.dismiss")}
        onClick={() => dismissToast(toast.id)}
      >
        <X aria-hidden />
      </button>
    </li>
  )
}
