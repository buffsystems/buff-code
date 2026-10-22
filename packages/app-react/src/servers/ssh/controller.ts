// Connecting to SSH hosts (#584), ported from the Solid window's ssh/controller.ts as a store: one
// attempt per host — started, answering the host's prompts, settled once the host is ready, failed
// or gone — and which host's prompt a dialog should show next.

import { isSshConnecting, type SshConfig, type SshItem, type SshPlatform } from "@opencode/app/ssh"
import { createStore, type Readable } from "../../core/store"

type Attempt = {
  active: boolean
  submitting: boolean
  prompted: boolean
  answered?: string
  error: boolean
  onConnected?: () => void
}

export function createSshController(input: {
  items: Readable<readonly SshItem[]>
  api: Pick<SshPlatform, "start" | "respond" | "cancel" | "disconnect" | "forget"> | undefined
  refresh: () => Promise<unknown>
  error: () => void
}) {
  const attempts = createStore<Record<string, Attempt | undefined>>({})
  const cancelled = new Set<string>()
  const item = (id: string) => input.items.get().find((entry) => entry.config.id === id)
  const patch = (id: string, value: Partial<Attempt> | undefined) =>
    attempts.set((current) => {
      if (!value) {
        const next = { ...current }
        delete next[id]
        return next
      }
      const base: Attempt = current[id] ?? { active: false, submitting: false, prompted: false, error: false }
      return { ...current, [id]: { ...base, ...value } }
    })

  const run = (id: string, task: () => Promise<unknown>) => {
    cancelled.delete(id)
    patch(id, { submitting: true, error: false })
    void task()
      .catch(() => {
        if (cancelled.has(id)) return
        patch(id, { error: true })
        if (!attempts.get()[id]?.prompted) input.error()
      })
      .finally(() => {
        if (!cancelled.has(id)) patch(id, { submitting: false })
      })
  }

  // An attempt ends when its host is ready, failed or disconnected, or another window took it over.
  const settle = () =>
    input.items.get().forEach((entry) => {
      const attempt = attempts.get()[entry.config.id]
      if (!attempt?.active || attempt.submitting) return
      const done =
        entry.stage === "ready" ||
        entry.stage === "failed" ||
        entry.stage === "disconnected" ||
        !!entry.authenticatingElsewhere ||
        (attempt.prompted && entry.stage === "authentication" && !entry.prompt)
      if (!done) return
      const onConnected = attempt.onConnected
      patch(entry.config.id, { active: false, onConnected: undefined })
      if (entry.stage === "ready" && onConnected) queueMicrotask(onConnected)
    })
  const stops = [input.items.subscribe(settle), attempts.subscribe(settle)]

  return {
    attempts,
    item,
    submitting: (id: string) => !!attempts.get()[id]?.submitting,
    error: (id: string) => !!attempts.get()[id]?.error,
    answered: (id: string) => {
      const prompt = item(id)?.prompt
      const attempt = attempts.get()[id]
      return !!prompt && !attempt?.error && attempt?.answered === prompt.id
    },
    pending: (id: string) =>
      !!attempts.get()[id]?.submitting ||
      !!item(id)?.authenticatingElsewhere ||
      isSshConnecting(item(id)?.stage ?? "disconnected"),
    /** The host whose prompt (or update notice) no dialog has shown yet. */
    next: () =>
      input.items.get().find((entry) => {
        const attempt = attempts.get()[entry.config.id]
        return (
          attempt?.active &&
          !attempt.submitting &&
          !attempt.prompted &&
          !attempt.error &&
          (entry.prompt || entry.stage === "incompatible")
        )
      }),
    opened: (id: string) => patch(id, { prompted: true }),
    connect(config: SshConfig, options?: { dialog?: boolean; replace?: boolean; onConnected?: () => void }) {
      const api = input.api
      const attempt = attempts.get()[config.id]
      if (!api || item(config.id)?.authenticatingElsewhere) return
      if (attempt?.submitting || (attempt?.active && !attempt.error && !options?.replace)) return
      patch(config.id, {
        active: true,
        submitting: true,
        prompted: !!options?.dialog,
        answered: undefined,
        error: false,
        onConnected: options?.onConnected ?? (options?.replace ? attempt?.onConnected : undefined),
      })
      // Observe the admission before an older disconnected snapshot reads as a cancel.
      run(config.id, () => api.start({ ...config, replace: options?.replace }).then(input.refresh))
    },
    respond(id: string, prompt: string, value: string) {
      const api = input.api
      const attempt = attempts.get()[id]
      if (!api || item(id)?.prompt?.id !== prompt || attempt?.submitting) return
      if (attempt?.answered === prompt && !attempt.error) return
      patch(id, { answered: prompt })
      run(id, () => api.respond(id, prompt, value))
    },
    cancel(id: string) {
      cancelled.add(id)
      patch(id, undefined)
      const api = input.api
      if (!api) return
      void api
        .cancel(id)
        .then(() => (item(id)?.saved ? undefined : api.forget(id)))
        .catch(() => undefined)
    },
    restore: (config: SshConfig) => input.api?.start({ ...config, background: true }),
    disconnect: (id: string) => input.api?.disconnect(id),
    forget: (id: string) => input.api?.forget(id),
    dispose: () => stops.forEach((stop) => stop()),
  }
}

export type SshController = ReturnType<typeof createSshController>
