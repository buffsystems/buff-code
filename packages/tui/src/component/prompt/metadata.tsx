import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

export function PromptMetadataRow(props: {
  mode: "normal" | "shell"
  agent?: string
  /**
   * The work mode (#894): Work, Plan, Setup — shown as one switch with the mode in force marked,
   * in place of the lone agent name, when the row has room for it.
   */
  modes?: readonly { label: string; active: boolean }[]
  auto: boolean
  model: string
  provider: string
  variant?: string
  /** #837: the session's context cap, when below the model's window. */
  limit?: string
  muted: boolean
  highlight: RGBA
  agentAlpha: number
  modelAlpha: number
  variantAlpha: number
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => {
    if (props.mode === "shell") return { agent: props.agent ?? "Shell", model: "" }
    return promptMetadataLayout({
      width: Math.max(0, dimensions().width - (dimensions().width < 44 ? 9 : 13)),
      terminalWidth: dimensions().width,
      agent: props.agent ?? "",
      modes: props.modes?.map(modeText).join(" "),
      auto: props.auto,
      model: props.model,
      provider: props.provider,
      variant: props.variant,
      limit: props.limit,
    })
  })

  return (
    <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
      <Show
        when={(props.mode === "shell" || props.agent) && (layout().agent || layout().model)}
        fallback={<box height={1} />}
      >
        <Show
          when={props.mode === "normal" && props.modes && layout().modes}
          fallback={
            <Show when={layout().agent}>
              {(agent) => <text fg={fade(props.highlight, props.agentAlpha)}>{agent()}</text>}
            </Show>
          }
        >
          <box flexDirection="row" gap={1} flexShrink={0}>
            <For each={props.modes}>
              {(item) => (
                <text
                  fg={fade(item.active ? props.highlight : theme.text.muted, props.agentAlpha)}
                  attributes={item.active ? TextAttributes.BOLD : undefined}
                >
                  {modeText(item)}
                </text>
              )}
            </For>
          </box>
        </Show>
        <Show when={props.mode === "normal" && layout().auto}>
          <text fg={fade(theme.text.muted, props.agentAlpha)}>auto</text>
        </Show>
        <Show when={props.mode === "normal" && layout().model}>
          <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
            <Show when={layout().agent}>
              <text fg={fade(theme.text.muted, props.modelAlpha)}>·</text>
            </Show>
            <text
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={fade(props.muted ? theme.text.muted : theme.text.base, props.modelAlpha)}
            >
              {layout().model}
            </text>
            <Show when={layout().provider}>
              {(provider) => (
                <text flexShrink={0} fg={fade(theme.text.muted, props.modelAlpha)}>
                  {provider()}
                </text>
              )}
            </Show>
            <Show when={layout().variant}>
              {(variant) => (
                <>
                  <text fg={fade(theme.text.muted, props.variantAlpha)}>·</text>
                  <text
                    fg={fade(theme.text.feedback.warning.base, props.variantAlpha)}
                    attributes={TextAttributes.BOLD}
                  >
                    {variant()}
                  </text>
                </>
              )}
            </Show>
            <Show when={layout().limit}>
              {(limit) => (
                <>
                  <text fg={fade(theme.text.muted, props.modelAlpha)}>·</text>
                  <text fg={fade(theme.text.muted, props.modelAlpha)}>{limit()}</text>
                </>
              )}
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

/** The mode in force is bracketed as well as coloured: a terminal without colours still tells it. */
const modeText = (item: { label: string; active: boolean }) => (item.active ? `[${item.label}]` : item.label)

function fade(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

type Layout = {
  agent?: string
  /** The work-mode switch shown in place of the agent name. */
  modes?: boolean
  auto?: boolean
  model: string
  provider?: string
  variant?: string
  limit?: string
}

export function promptMetadataLayout(input: {
  width: number
  terminalWidth: number
  agent: string
  /** The work-mode switch as text, when there is one: «Work Plan Setup». */
  modes?: string
  auto?: boolean
  model: string
  provider: string
  variant?: string
  limit?: string
}) {
  const agent = input.terminalWidth < 44 ? undefined : input.agent
  const provider = input.terminalWidth < 44 ? "" : input.provider
  const candidates: Layout[] = [
    { agent, auto: input.auto, model: input.model, provider, variant: input.variant, limit: input.limit },
    { agent, model: input.model, provider, variant: input.variant, limit: input.limit },
    {
      agent,
      model: input.model,
      provider: provider.split(" / ").at(-1) ?? provider,
      variant: input.variant,
      limit: input.limit,
    },
    { agent, model: input.model, variant: input.variant, limit: input.limit },
    { agent, model: input.model, variant: input.variant },
  ]
  // The work mode (#894) takes the agent's place when the row still fits with it.
  if (agent && input.modes) {
    const wide = candidates.find(
      (candidate) => stringWidth(text({ ...candidate, agent: input.modes })) <= input.width,
    )
    if (wide) return { ...wide, modes: true }
  }
  const fit = candidates.find((candidate) => stringWidth(text(candidate)) <= input.width)
  if (fit) return fit

  const prefix = agent ? `${agent} · ` : ""
  const suffix = input.variant ? ` · ${input.variant}` : ""
  return {
    agent,
    model: Locale.truncateWidth(
      input.model,
      Math.max(9, input.width - stringWidth(prefix) - stringWidth(suffix)),
    ).replace(/\s+…$/, "…"),
    variant: input.variant,
  }
}

function text(input: Layout) {
  return [
    ...(input.agent ? [input.agent] : []),
    ...(input.auto ? ["auto"] : []),
    ...(input.model ? [...(input.agent ? ["·"] : []), input.model] : []),
    ...(input.provider ? [input.provider] : []),
    ...(input.variant ? ["·", input.variant] : []),
    ...(input.limit ? ["·", input.limit] : []),
  ].join(" ")
}
