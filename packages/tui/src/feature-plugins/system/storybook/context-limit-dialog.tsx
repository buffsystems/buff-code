// Story (#837): the /context dialog over a 400k model — the choices that fit the window, the cap
// in force, a custom size. The pick is written under the dialog; Enter opens it again.
import type { Plugin } from "@opencode/plugin/tui"
import { createSignal, onMount } from "solid-js"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { DialogContextLimitView } from "../../../component/dialog-context-limit"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const MODEL_WINDOW = 400_000

function ContextLimitDialogStory(props: { context: Plugin.Context }) {
  const theme = props.context.theme
  const [current, setCurrent] = createSignal(200_000)
  const open = () =>
    props.context.ui.dialog.show(() => (
      <DialogContextLimitView modelWindow={MODEL_WINDOW} current={current()} onSelect={setCurrent} />
    ))
  onMount(open)
  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "return", title: "Open the dialog", group: "Storybook", run: open },
    ],
  }))
  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <text fg={theme.text.base}>
        <b>Context window dialog</b>
      </text>
      <text fg={theme.text.muted}>Model window {BuffContextWindow.format(MODEL_WINDOW)}</text>
      <text fg={theme.text.base}>Chosen: {BuffContextWindow.label(current(), MODEL_WINDOW)}</text>
      <StoryFooter
        context={props.context}
        title="Context window dialog"
        controls={[
          { shortcut: "enter", label: "open the dialog" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const contextLimitDialogStory: Story = {
  id: "context-limit-dialog",
  title: "Context window dialog",
  render: (context) => <ContextLimitDialogStory context={context} />,
}
