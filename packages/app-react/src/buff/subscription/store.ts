// The Buff account's subscription usage (#966), one state the chip, the dialog and the settings
// section read. What to show and in which words is @opencode/schema/buff-subscription's, as in
// the console. The subscription is the person's, not the directory's: one entry per server.

import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import type { Server } from "../../core/servers"
import { createStore } from "../../core/store"

export type Known = { readonly usage?: BuffSubscription.Usage; readonly problem?: string }

/** By server key. */
export const subscription = createStore<ReadonlyMap<string, Known>>(new Map())

type Get = () => Promise<BuffSubscription.Usage>

/** Read the usage again; without a sign-in there is nothing; a failure keeps the numbers. */
export async function refreshSubscription(key: string, get: Get) {
  const put = (value: Known) => subscription.set((map) => new Map(map).set(key, value))
  await get().then(
    (usage) => put({ usage }),
    (error: unknown) => {
      const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : ""
      if (type === "signed_out") return put({})
      // The reason is the server's own words or ours in English; the screen translates it (#472).
      put({
        usage: subscription.get().get(key)?.usage,
        problem: formatServerError(error, undefined, "Could not get the subscription usage."),
      })
    },
  )
}

/** The subscription is the person's: outside a project (the settings) the server's own location will do. */
export function serverSubscription(server: Server, directory: string | undefined): Get {
  return () =>
    server
      .api()
      .rpc(BuffSubscription.Rpc)
      .get(undefined, directory ? { location: { directory } } : undefined)
}

/** How the busiest window reads: calm, nearly used up, used up — or the subscription is not active. */
export function usageState(usage: BuffSubscription.Usage): "ok" | "low" | "exhausted" {
  const used = BuffSubscription.tightest(usage)?.usedPct ?? 0
  if (usage.plan.status !== "active" || used >= 100) return "exhausted"
  return used >= BuffSubscription.LOW_PCT ? "low" : "ok"
}

/** A day in the window's language: «24.12.2026». */
export function dayLabel(iso: string, intl: string): string | undefined {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  return new Intl.DateTimeFormat(intl, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
    at,
  )
}
