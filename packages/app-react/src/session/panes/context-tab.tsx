// The Context tab (#584): the Solid SessionContextTab — the session's model, context window and
// token use from its last answer, message counts and cost, the system prompt and every raw
// message as JSON.

import { createSessionContextFormatter } from "@opencode/app/react-reuse/session-context-format"
import { Accordion, AccordionItem, ScrollArea } from "@buff/ui/react"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useMemo } from "react"
import { locationKey } from "../../core/data/state"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import type { PaneSession } from "./session"

const NO_MESSAGES: SessionMessageInfo[] = []

export function ContextTab(props: { session: PaneSession }) {
  const i18n = useI18n()
  const { server, sessionID, directory } = props.session
  const info = useServerData(server, (state) => state.session.info[sessionID])
  const messages = useServerData(server, (state) => state.session.message[sessionID] ?? NO_MESSAGES)
  const location = useServerData(server, (state) =>
    directory === undefined ? undefined : state.location[locationKey({ directory })],
  )
  const format = useMemo(() => createSessionContextFormatter(i18n.intl), [i18n.intl])
  const usd = useMemo(() => new Intl.NumberFormat(i18n.intl, { style: "currency", currency: "USD" }), [i18n.intl])

  const last = messages.findLast((item) => item.type === "assistant" && !!item.tokens)
  const context = (() => {
    if (last?.type !== "assistant" || !last.tokens) return
    const tokens = last.tokens
    const provider = location?.provider?.find((item) => item.id === last.model.providerID)
    const model = location?.model?.find((item) => item.providerID === last.model.providerID && item.id === last.model.id)
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    const limit = model?.limit.context
    return {
      message: last,
      tokens,
      provider: provider?.name ?? last.model.providerID,
      model: model?.name ?? last.model.id,
      limit,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
    }
  })()
  const user = messages.filter((message) => message.type === "user").length
  const assistant = messages.filter((message) => message.type === "assistant").length
  const system = messages.findLast((message) => message.type === "system")
  const prompt = system?.type === "system" ? system.text.trim() : ""

  const stats: [string, string][] = [
    ["context.stats.session", info?.title ?? sessionID],
    ["context.stats.messages", messages.length.toLocaleString(i18n.intl)],
    ["context.stats.provider", context?.provider ?? "—"],
    ["context.stats.model", context?.model ?? "—"],
    ["context.stats.limit", format.number(context?.limit)],
    ["context.stats.totalTokens", format.number(context?.total)],
    ["context.stats.usage", format.percent(context?.usage)],
    ["context.stats.inputTokens", format.number(context?.tokens.input)],
    ["context.stats.outputTokens", format.number(context?.tokens.output)],
    ["context.stats.reasoningTokens", format.number(context?.tokens.reasoning)],
    [
      "context.stats.cacheTokens",
      `${format.number(context?.tokens.cache.read)} / ${format.number(context?.tokens.cache.write)}`,
    ],
    ["context.stats.userMessages", user.toLocaleString(i18n.intl)],
    ["context.stats.assistantMessages", assistant.toLocaleString(i18n.intl)],
    ["context.stats.totalCost", usd.format(info?.cost ?? 0)],
    ["context.stats.sessionCreated", format.time(info?.time.created)],
    ["context.stats.lastActivity", format.time(context?.message.time.created)],
  ]

  return (
    <ScrollArea className="h-full" viewportProps={{ className: "scroll-view__viewport" }}>
      <div data-slot="session-usage-content" className="flex flex-col gap-6 px-4 pt-4 pb-6 md:gap-10 md:px-6 md:pb-10">
        <dl className="panes-context-stats grid grid-cols-1 gap-4">
          {stats.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="ui-note">{i18n.t(label as Parameters<typeof i18n.t>[0])}</dt>
              <dd className="panes-context-value">{value}</dd>
            </div>
          ))}
        </dl>
        {prompt && (
          <section className="flex flex-col gap-2">
            <h3 className="ui-note">{i18n.t("context.systemPrompt.title")}</h3>
            <pre className="ui-code-block whitespace-pre-wrap">{prompt}</pre>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h3 className="ui-note">{i18n.t("context.rawMessages.title")}</h3>
          <Accordion type="multiple">
            {messages.map((message) => (
              <AccordionItem
                key={message.id}
                value={message.id}
                title={
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {message.type} • {message.id}
                    </span>
                    <span className="ui-note shrink-0">{format.time(message.time.created)}</span>
                  </span>
                }
              >
                <pre className="ui-code-block whitespace-pre-wrap">{JSON.stringify(message, null, 2)}</pre>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </div>
    </ScrollArea>
  )
}
