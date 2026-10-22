import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { isShellNotFoundError, type LocationRef, type ShellInfo } from "@opencode/client"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import stripAnsi from "strip-ansi"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { BuffBackground } from "@opencode/schema/buff-background"
import { stopBackground, useNow } from "../feature-plugins/buff/background"
import { t } from "../feature-plugins/buff/locale"

// Размер одной страницы чтения; показывается весь вывод (Buff #456: без обрезки до последних 64 КБ).
const PAGE_BYTES = 64 * 1024

export function DialogShellOutput(props: { shell: ShellInfo; location: LocationRef }) {
  const client = useClient()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const [info, setInfo] = createSignal(props.shell)
  const [output, setOutput] = createSignal<string>()
  const [error, setError] = createSignal("")
  const text = createMemo(() => stripAnsi(output() ?? "").replace(/\r\n?/g, "\n"))
  const height = () => Math.max(3, Math.floor(dimensions().height * 0.6) - 6)
  // Buff (#456): время работы и остановка прямо из вывода.
  const now = useNow()
  const stop = () => {
    if (info().status !== "running") return
    void stopBackground(client, props.shell.id, { directory: props.location.directory })
  }
  let scroll: ScrollBoxRenderable | undefined

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  createEffect(() => {
    // The running-shell inventory drops exited commands. Keep this view tied to
    // the opened ID and its original Location, not the list's current selection.
    const id = props.shell.id
    const location = { directory: props.location.directory }
    let cursor = 0
    let disposed = false
    let missing = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      if (untrack(info).status === "running") {
        const current = await client.api.shell.get({ id, location })
        if (disposed) return false
        setInfo(current.data)
      }
      const page = await client.api.shell.output({ id, location, cursor, limit: PAGE_BYTES })
      if (disposed) return false
      cursor = page.data.cursor
      setOutput((previous) => (previous ?? "") + page.data.output)
      setError("")
      return cursor < page.data.size
    }

    const poll = () => {
      void load()
        .catch((cause: unknown) => {
          if (disposed) return
          missing = isShellNotFoundError(cause)
          setError(missing ? t("Shell output is no longer available.") : t("Unable to read shell output. Retrying…"))
        })
        .then((more) => {
          // Poll only while the viewer is open, including after exit so the final
          // file flush is observed. Never overlap reads or reload earlier pages.
          if (!disposed && !missing) timer = setTimeout(poll, more ? 0 : 1_000)
        })
    }
    poll()
    onCleanup(() => {
      disposed = true
      clearTimeout(timer)
    })
  })

  const status = () => {
    if (info().status === "running")
      return t("Running · {time}", { time: BuffBackground.since(info().time.started, now(), t) ?? "" })
    if (info().status === "timeout") return t("Timed out")
    if (info().status === "killed") return t("Killed")
    return info().exit === undefined ? t("Exited") : t("Exited · code {code}", { code: info().exit! })
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: t("Scroll output up"), group: t("Shell"), run: () => scroll?.scrollBy(-1) },
      { bind: "down", title: t("Scroll output down"), group: t("Shell"), run: () => scroll?.scrollBy(1) },
      { bind: "pageup", title: t("Previous output page"), group: t("Shell"), run: () => scroll?.scrollBy(-height()) },
      { bind: "pagedown", title: t("Next output page"), group: t("Shell"), run: () => scroll?.scrollBy(height()) },
      { bind: "home", title: t("First loaded output"), group: t("Shell"), run: () => scroll?.scrollTo(0) },
      { bind: "end", title: t("Follow shell output"), group: t("Shell"), run: () => scroll?.scrollTo(Infinity) },
      { bind: "ctrl+d", title: t("Stop shell command"), group: t("Shell"), run: stop },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} flexGrow={1}>
          {t("Shell output")}
        </text>
        <text fg={theme.text.muted}>{status()}</text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text.muted} maxHeight={3} wrapMode="word">
        {props.shell.command}
      </text>
      <scrollbox
        id="shell-output-scroll"
        ref={(value: ScrollBoxRenderable) => (scroll = value)}
        height={height()}
        stickyScroll
        stickyStart="bottom"
        scrollbarOptions={{ visible: false }}
      >
        <text fg={theme.text.base} wrapMode="word">
          {text() ||
            (output() === undefined
              ? t("Loading output…")
              : t("No captured output. Output redirected to files is not shown here."))}
        </text>
      </scrollbox>
      <Show when={error()}>
        <text fg={theme.text.feedback.error.base}>{error()}</text>
      </Show>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={theme.text.muted}>{t("↑/↓ scroll")}</text>
        <text fg={theme.text.muted}>{t("end follow")}</text>
        <Show when={info().status === "running"}>
          <text fg={theme.text.muted}>{t("ctrl+d stop")}</text>
        </Show>
        <text fg={theme.text.muted}>{t("esc back")}</text>
      </box>
    </box>
  )
}
