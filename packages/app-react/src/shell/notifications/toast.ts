// The window's toasts (#584): a plain-TS stack anyone can push to — a title, a description, an
// icon, actions — with the Solid window's rules: an identical toast on top pulses instead of
// stacking, a persistent one stays until dismissed. @buff/ui's toast carries a message only.

import { createStore } from "../../core/store"

export type ToastVariant = "default" | "success" | "error" | "loading"
export type ToastAction = { label: string; onClick: (() => void) | "dismiss" }
export type ToastOptions = {
  title?: string
  description?: string
  variant?: ToastVariant
  /** Show the variant's icon (success shows it by default). */
  icon?: boolean
  duration?: number
  persistent?: boolean
  actions?: ToastAction[]
}
export type Toast = ToastOptions & { id: number; key: string; pulse: number }

const DEFAULT_DURATION = 5000
const DESCRIPTION_LIMIT = 600

export const toasts = createStore<Toast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const sequence = { next: 0 }

export function showToast(input: ToastOptions | string) {
  const options = bound(typeof input === "string" ? { description: input } : input)
  const key = JSON.stringify([
    options.title,
    options.description,
    options.variant,
    options.duration,
    options.persistent,
    options.actions?.map((action) => action.label),
  ])
  const top = toasts.get().at(-1)
  if (top?.key === key) {
    toasts.set((list) =>
      list.map((item) => (item.id === top.id ? { ...item, ...options, pulse: item.pulse + 1 } : item)),
    )
    schedule(top.id, options)
    return top.id
  }
  const id = ++sequence.next
  toasts.set((list) => [...list, { ...options, id, key, pulse: 0 }])
  schedule(id, options)
  return id
}

/** Change a shown toast in place (a progress label), keeping its place and timer. */
export function updateToast(id: number, patch: Pick<ToastOptions, "title" | "description">) {
  toasts.set((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))
}

export function dismissToast(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts.set((list) => list.filter((item) => item.id !== id))
}

function schedule(id: number, options: ToastOptions) {
  clearTimeout(timers.get(id))
  if (options.persistent) return
  timers.set(
    id,
    setTimeout(() => dismissToast(id), options.duration ?? DEFAULT_DURATION),
  )
}

function bound(options: ToastOptions): ToastOptions {
  const description = options.description
  if (!description || description.length <= DESCRIPTION_LIMIT) return options
  return { ...options, description: `${description.slice(0, DESCRIPTION_LIMIT)}…` }
}
