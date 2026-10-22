// The session header's own actions (#584): the context-usage button — the Solid SessionContextUsage,
// a ring of the context window's use with cost, use and tokens on hover, opening the side panel's
// Context tab through the panes' contract — and room for the review toggle floating over the corner.

import { IconButton, ProgressCircle, Tooltip } from "@buff/ui/react"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useMemo, type ReactNode } from "react"
import { useBuffSessionCost } from "../buff/billing/billing"
import { locationKey } from "../core/data/state"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { useSession } from "./context"
import { sideActions } from "./panes/side-actions"

const NO_MESSAGES: SessionMessageInfo[] = []

/** The context usage, the timeline's own actions (`children`), then room for the review toggle. */
export function SessionHeaderActions(props: { children?: ReactNode }) {
  return (
    <>
      <ContextUsage />
      {props.children}
      <div className="size-7 shrink-0" aria-hidden />
    </>
  )
}

function ContextUsage() {
  const i18n = useI18n()
  const { server, sessionID } = useSession()
  const info = useServerData(server, (state) => state.session.info[sessionID])
  const directory = info?.location.directory ?? ""
  const messages = useServerData(server, (state) => state.session.message[sessionID] ?? NO_MESSAGES)
  const location = useServerData(server, (state) =>
    directory ? state.location[locationKey({ directory })] : undefined,
  )
  const buffCost = useBuffSessionCost(server, sessionID, directory)
  const usd = useMemo(() => new Intl.NumberFormat(i18n.intl, { style: "currency", currency: "USD" }), [i18n.intl])
  const last = messages.findLast((item) => item.type === "assistant" && !!item.tokens)
  const usage = (() => {
    if (last?.type !== "assistant" || !last.tokens) return
    const tokens = last.tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    const model = location?.model?.find(
      (item) => item.providerID === last.model.providerID && item.id === last.model.id,
    )
    const limit = model?.limit.context
    return { total, percent: limit ? Math.round((total / limit) * 100) : undefined }
  })()
  const cost = buffCost ? buffCost.text || "—" : usd.format(info?.cost ?? 0)
  const rows: [string, string][] = [
    [i18n.t("context.usage.cost"), cost],
    [i18n.t("context.usage.usage"), `${usage?.percent ?? 0}%`],
    [i18n.t("context.usage.tokens"), usage?.total.toLocaleString(i18n.intl) ?? "0"],
  ]
  return (
    <Tooltip
      side="bottom"
      content={
        <div className="flex w-[120px] flex-col gap-2">
          {rows.map(([name, value]) => (
            <div key={name} className="flex min-w-0 items-center gap-4">
              <span className="shrink-0 opacity-70">{name}</span>
              <span className="ms-auto min-w-0 truncate text-end">{value}</span>
            </div>
          ))}
        </div>
      }
    >
      <IconButton
        icon={<ProgressCircle value={usage?.percent ?? 0} size={16} strokeWidth={2} />}
        size="xs"
        aria-label={i18n.t("context.usage.view")}
        onClick={() => sideActions()?.toggleContext()}
      />
    </Tooltip>
  )
}
