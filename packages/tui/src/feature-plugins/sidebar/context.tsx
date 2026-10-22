import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { contextUsage } from "../../util/session"
import { buffSessionCost } from "../buff/billing"
import { n, t } from "../buff/locale"
import { localeTag } from "../buff/locale-state"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))
  // Buff (#455): у сессии на модели Buff — оценка в рублях по ценам тарифа.
  const buffCost = createMemo(() => buffSessionCost(props.context, props.sessionID))

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )

  return (
    <Show when={state() || cost() > 0 || buffCost()}>
      <box>
        <text fg={theme.text.base}>
          <b>{t("Context")}</b>
        </text>
        <Show when={state()}>
          {(value) => (
            <>
              <text fg={theme.text.muted}>
                {n(value().tokens, "{n} token|{n} tokens", { n: value().tokens.toLocaleString(localeTag()) })}
              </text>
              <Show when={value().percent !== undefined}>
                <text fg={theme.text.muted}>{t("{percent}% used", { percent: value().percent ?? 0 })}</text>
              </Show>
            </>
          )}
        </Show>
        <Show
          when={buffCost()}
          fallback={
            <Show when={cost() > 0}>
              <text fg={theme.text.muted}>{t("{cost} spent", { cost: money.format(cost()) })}</text>
            </Show>
          }
        >
          <text fg={theme.text.muted}>{t("{cost} — estimated by the tariff", { cost: buffCost() ?? "" })}</text>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
