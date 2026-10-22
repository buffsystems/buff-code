import { RGBA, TextAttributes } from "@opentui/core"
import { For, createSignal, onCleanup, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { brain, logo } from "../logo"

const brand = RGBA.fromHex(brain.color)
const glint = RGBA.fromHex(brain.glint)

// A highlight sweeps diagonally across the brain at one cell per frame, then pauses before the next pass.
function Brain(props: { lines: readonly string[] }) {
  const [frame, setFrame] = createSignal(0)
  const timer = setInterval(() => setFrame((value) => value + 1), 50)
  onCleanup(() => clearInterval(timer))
  const span = () => (props.lines[0]?.length ?? 0) + props.lines.length * 2
  const color = (x: number, y: number) => {
    const head = (frame() % (span() + 24)) - 4
    const distance = Math.abs(x + y * 2 - head)
    return tint(brand, glint, Math.max(0, 1 - distance / 3))
  }
  return (
    <box>
      <For each={props.lines}>
        {(line, y) => (
          <box flexDirection="row">
            <For each={Array.from(line)}>
              {(char, x) => (
                <text fg={color(x(), y())} selectable={false}>
                  {char}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  // The largest brain that leaves the screen room for the prompt; the 40-column wordmark sits beside it.
  const mark = () => {
    const size = dimensions()
    if (size.width >= 70 && size.height >= 26) return brain.large
    if (size.width >= 62 && size.height >= 22) return brain.medium
    return brain.small
  }

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background.base, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  return (
    <box>
      {dimensions().height < 12 ? null : dimensions().width < 30 ? (
        <Brain lines={brain.small} />
      ) : dimensions().width < 53 ? (
        <box flexDirection="row" gap={2} alignItems="center">
          <Brain lines={brain.small} />
          <box>
            <For each={logo.left.slice(1)}>
              {(line) => <box flexDirection="row">{renderLine(line, theme.text.muted, false)}</box>}
            </For>
            <For each={logo.right}>
              {(line) => <box flexDirection="row">{renderLine(line, theme.text.base, true)}</box>}
            </For>
          </box>
        </box>
      ) : (
        <box flexDirection="row" gap={2} alignItems="center">
          <Brain lines={mark()} />
          <box>
            <For each={logo.left}>
              {(line, index) => (
                <box flexDirection="row" gap={1}>
                  <box flexDirection="row">{renderLine(line, theme.text.muted, false)}</box>
                  <box flexDirection="row">{renderLine(logo.right[index()], theme.text.base, true)}</box>
                </box>
              )}
            </For>
          </box>
        </box>
      )}
    </box>
  )
}
