// The organization's balance per directory (#455), one state the chip, the strip, the dialog and
// the session cost read; ported from the Solid window's buff/billing.tsx. What to show and in
// which words is @opencode/schema/buff-billing's, as in the console.

import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffBilling } from "@opencode/schema/buff-billing"
import type { Server } from "../../core/servers"
import { createStore } from "../../core/store"

export type Known = { readonly info?: BuffBilling.Info; readonly problem?: string }

/** By `${server}\0${directory}`. */
export const billing = createStore<ReadonlyMap<string, Known>>(new Map())
/** Strips hidden until the window restarts, by `${org}:${state}`. */
export const hiddenFunds = createStore<ReadonlySet<string>>(new Set())

export const billingKey = (server: Server, directory: string) => `${server.key}\0${directory}`

type Get = (directory: string) => Promise<BuffBilling.Info>

/** Read the balance again; without sign-in or context there is nothing; a failure keeps the numbers. */
export async function refreshBilling(key: string, directory: string, get: Get) {
  const put = (value: Known) => billing.set((map) => new Map(map).set(key, value))
  await get(directory).then(
    (info) => put({ info }),
    (error: unknown) => {
      const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : ""
      if (type === "signed_out" || type === "no_context") return put({})
      // The reason is an English string (the server's or ours); the screen translates it (#472).
      put({
        info: billing.get().get(key)?.info,
        problem: formatServerError(error, undefined, "Could not get the balance."),
      })
    },
  )
}

export function serverBilling(server: Server): Get {
  return (directory) => server.api().rpc(BuffBilling.Rpc).get(undefined, { location: { directory } })
}

export const billingState = (info: BuffBilling.Info) => (info.exhausted ? "exhausted" : info.low ? "low" : "ok")
