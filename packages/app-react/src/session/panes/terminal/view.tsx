// One terminal's screen (#584): ghostty-web mounted imperatively into a ref, as the Solid Terminal
// does — restored from the saved screen, fitted to its box, coloured from the design tokens, linked
// to its PTY by a reconnecting socket, and saved (scrollback, cursor, size) when it unmounts.

import { createPtyClient } from "@opencode/client/pty"
import { SerializeAddon } from "@opencode/app/react-reuse/terminal-serialize"
import { disposeIfDisposable, getHoveredLinkText, setOptionIfSupported } from "@opencode/app/react-reuse/terminal-runtime"
import { terminalKeyInput } from "@opencode/app/react-reuse/terminal-key-event"
import { terminalWriter } from "@opencode/app/react-reuse/terminal-writer"
import type { FitAddon, Ghostty, Terminal as Term } from "ghostty-web"
import { useEffect, useRef } from "react"
import { matchKeybind, parseKeybind } from "../../../commands/keybind"
import type { Server } from "../../../core/servers"
import { useI18n } from "../../../i18n/provider"
import { usePlatform } from "../../../platform/context"
import { showToast } from "../../../shell/notifications/toast"
import { textSize } from "../../../buff/text-size"
import { useStore } from "../../../react/use-store"
import { useSettings, useShellSettings } from "../../../shell/settings-context"
import { paintedMode, readTokens, terminalColors, terminalText } from "./appearance"
import { createPtyConnection } from "./connection"
import type { LocalPTY } from "./state"

export const TOGGLE_TERMINAL_ID = "terminal.toggle"
export const DEFAULT_TOGGLE_TERMINAL_KEYBIND = "ctrl+`"
// Serialising on unmount walks rows x cols on the main thread; the newest 2k rows keep what people
// scroll back through while capping the teardown and the snapshot (the live terminal keeps 10k).
const PERSISTED_SCROLLBACK = 2_000

export type TerminalViewProps = {
  pty: LocalPTY
  server: Server
  directory: string
  autoFocus?: boolean
  onAutoFocus?: () => void
  onConnect?: () => void
  onConnectError?: (error: unknown) => void
  onCleanup?: (pty: Partial<LocalPTY> & { id: string }) => void
}

let shared: Promise<{ mod: typeof import("ghostty-web"); ghostty: Ghostty }> | undefined

const loadGhostty = () => {
  if (shared) return shared
  shared = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
    .catch((error: unknown) => {
      shared = undefined
      throw error
    })
  return shared
}

const positive = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined

export function TerminalView(props: TerminalViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const i18n = useI18n()
  const platform = usePlatform()
  const toggleKeybind = useShellSettings((settings) => settings.keybinds[TOGGLE_TERMINAL_ID])
  const toggle = useRef(toggleKeybind)
  toggle.current = toggleKeybind
  const text = useRef(i18n)
  text.current = i18n
  const colors = terminalColors(paintedMode(), readTokens())
  // The face and size follow Settings live, as the Solid terminal's effects do.
  const face = useSettings((settings) => settings.appearance.terminal)
  const sizes = useStore(textSize, (value) => value)
  const look = terminalText(face, sizes)
  const lookRef = useRef(look)
  lookRef.current = look
  const applyLook = useRef<() => void>(undefined)
  useEffect(() => applyLook.current?.(), [look.fontFamily, look.fontSize])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const initial = latest.current
    const id = initial.pty.id
    const location = { directory: initial.directory }
    const restore = typeof initial.pty.buffer === "string" ? initial.pty.buffer : ""
    const cols = positive(initial.pty.cols)
    const rows = positive(initial.pty.rows)
    const restoreSize = restore && cols && rows ? { cols, rows } : undefined
    const scrollY = typeof initial.pty.scrollY === "number" ? initial.pty.scrollY : undefined
    const start = Number.isSafeInteger(initial.pty.cursor) ? initial.pty.cursor : undefined
    const cleanups: (() => void)[] = []
    const local = {
      disposed: false,
      revealed: false,
      term: undefined as Term | undefined,
      serializer: undefined as SerializeAddon | undefined,
      fit: undefined as FitAddon | undefined,
      fitFrame: undefined as number | undefined,
      sizeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      pendingSize: undefined as { cols: number; rows: number } | undefined,
      lastSize: undefined as { cols: number; rows: number } | undefined,
      output: undefined as ReturnType<typeof terminalWriter> | undefined,
      connection: undefined as ReturnType<typeof createPtyConnection> | undefined,
    }

    const reveal = () => {
      if (local.revealed || !local.serializer?.serializeAsText({ trimWhitespace: true })) return
      local.revealed = true
      element.style.opacity = "1"
    }

    const pushSize = (size: { cols: number; rows: number }) =>
      void initial.server
        .api()
        .pty.update({ ptyID: id, location, size })
        .catch(() => undefined)

    const scheduleSize = (cols: number, rows: number) => {
      if (local.disposed) return
      if (local.lastSize?.cols === cols && local.lastSize.rows === rows) {
        local.pendingSize = undefined
        clearTimeout(local.sizeTimer)
        local.sizeTimer = undefined
        return
      }
      local.pendingSize = { cols, rows }
      if (!local.lastSize) {
        local.lastSize = local.pendingSize
        return pushSize(local.pendingSize)
      }
      if (local.sizeTimer !== undefined) return
      local.sizeTimer = setTimeout(() => {
        local.sizeTimer = undefined
        const next = local.pendingSize
        local.pendingSize = undefined
        if (!next || local.disposed) return
        if (local.lastSize?.cols === next.cols && local.lastSize.rows === next.rows) return
        local.lastSize = next
        pushSize(next)
      }, 100)
    }

    const scheduleFit = () => {
      if (local.disposed || !local.fit || local.fitFrame !== undefined) return
      local.fitFrame = requestAnimationFrame(() => {
        local.fitFrame = undefined
        if (!local.disposed) local.fit?.fit()
      })
    }

    const apply = () => {
      if (!local.term) return
      setOptionIfSupported(local.term, "fontFamily", lookRef.current.fontFamily)
      setOptionIfSupported(local.term, "fontSize", lookRef.current.fontSize)
      scheduleFit()
    }
    applyLook.current = apply
    cleanups.push(() => {
      if (applyLook.current === apply) applyLook.current = undefined
    })

    const focusTerminal = () => {
      const term = local.term
      if (!term) return
      const focus = () => (term.textarea ? term.textarea.focus({ preventScroll: true }) : term.focus())
      focus()
      setTimeout(focus, 0)
    }

    const pointerDown = () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== element && !element.contains(active)) active.blur()
      focusTerminal()
    }

    const linkClick = (event: MouseEvent) => {
      if ((!event.shiftKey && !event.ctrlKey && !event.metaKey) || event.altKey || event.button !== 0) return
      const link = local.term ? getHoveredLinkText(local.term) : undefined
      if (!link) return
      event.preventDefault()
      event.stopImmediatePropagation()
      platform.openExternal(link)
    }

    const listen = <Type extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: Type,
      handler: (event: HTMLElementEventMap[Type]) => void,
      capture = false,
    ) => {
      target.addEventListener(type, handler, capture)
      cleanups.push(() => target.removeEventListener(type, handler, capture))
    }

    const run = async () => {
      const loaded = await loadGhostty()
      if (local.disposed) return
      const term = new loaded.mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cols: restoreSize?.cols,
        rows: restoreSize?.rows,
        fontSize: lookRef.current.fontSize,
        fontFamily: lookRef.current.fontFamily,
        allowTransparency: false,
        convertEol: false,
        theme: terminalColors(paintedMode(), readTokens()),
        scrollback: 10_000,
        ghostty: loaded.ghostty,
      })
      cleanups.push(() => term.dispose())
      local.term = term
      setOptionIfSupported(term, "colorScheme", paintedMode())
      local.output = terminalWriter((data, done) => term.write(data, () => done?.()))

      term.attachCustomKeyEventHandler((event) => {
        const input = terminalKeyInput(event)
        if (input) {
          term.input(input, true)
          return true
        }
        if (event.ctrlKey && event.shiftKey && !event.metaKey && event.key.toLowerCase() === "c") {
          document.execCommand("copy")
          return true
        }
        // The toggle keybind belongs to the window: let it through to close the panel.
        return matchKeybind(parseKeybind(toggle.current ?? DEFAULT_TOGGLE_TERMINAL_KEYBIND), event)
      })

      const fit = new loaded.mod.FitAddon()
      const serializer = new SerializeAddon()
      cleanups.push(() => disposeIfDisposable(fit))
      term.loadAddon(serializer)
      term.loadAddon(fit)
      local.fit = fit
      local.serializer = serializer

      const active = document.activeElement
      term.open(element)
      listen(element, "copy", (event) => {
        const selection = term.getSelection()
        if (!selection || !event.clipboardData) return
        event.preventDefault()
        event.clipboardData.setData("text/plain", selection)
      }, true)
      listen(element, "paste", (event) => {
        const pasted = event.clipboardData?.getData("text/plain") ?? event.clipboardData?.getData("text") ?? ""
        if (!pasted) return
        event.preventDefault()
        event.stopPropagation()
        term.paste(pasted)
      }, true)
      listen(element, "pointerdown", pointerDown)
      listen(element, "click", linkClick, true)
      const textarea = term.textarea
      if (textarea) {
        const blink = (on: boolean) => () => {
          term.options.cursorBlink = on
        }
        listen(textarea, "focus", blink(true))
        listen(textarea, "blur", blink(false))
      }

      if (latest.current.autoFocus === true) {
        focusTerminal()
        latest.current.onAutoFocus?.()
      }
      if (latest.current.autoFocus !== true) {
        // Opening a cached terminal must not take the focus from where the person is typing.
        const restoreFocus = () => {
          const current = document.activeElement
          if (current !== element && !element.contains(current)) return
          term.blur()
          term.textarea?.blur()
          if (active instanceof HTMLElement && active.isConnected) active.focus()
        }
        restoreFocus()
        const timer = setTimeout(restoreFocus, 0)
        cleanups.push(() => clearTimeout(timer))
      }

      void document.fonts?.ready.then(scheduleFit)
      const resized = term.onResize((size) => scheduleSize(size.cols, size.rows))
      cleanups.push(() => disposeIfDisposable(resized))
      const typed = term.onData((data) => local.connection?.send(data))
      cleanups.push(() => disposeIfDisposable(typed))

      const write = (data: string) =>
        new Promise<void>((resolve) => {
          if (!local.output) return resolve()
          local.output.push(data)
          local.output.flush(resolve)
        })
      const startResize = () => {
        fit.observeResize()
        window.addEventListener("resize", scheduleFit)
        cleanups.push(() => window.removeEventListener("resize", scheduleFit))
      }
      if (!restoreSize) {
        fit.fit()
        scheduleSize(term.cols, term.rows)
      }
      if (restore) {
        await write(restore)
        reveal()
      }
      if (restoreSize) {
        fit.fit()
        scheduleSize(term.cols, term.rows)
      }
      if (restore && scrollY !== undefined) term.scrollToLine(scrollY)
      startResize()
      if (local.disposed) return

      const client = createPtyClient(initial.server.api(), { url: initial.server.conn.http.url })
      local.connection = createPtyConnection({
        connect: (cursor) => client.connect({ ptyID: id, location, cursor }),
        gone: () =>
          initial.server
            .api()
            .pty.get({ ptyID: id, location })
            .then((result) => result.data.status === "exited")
            .catch((error: unknown) => !!error && typeof error === "object" && "_tag" in error && error._tag === "PtyNotFoundError"),
        cursor: start ?? (restore ? -1 : 0),
        onOpen: () => {
          latest.current.onConnect?.()
          scheduleSize(term.cols, term.rows)
          if (term.getMode(2031)) term.write("\x1b[?996n")
        },
        onOutput: (data) => {
          local.output?.push(data)
          if (!local.revealed) local.output?.flush(reveal)
        },
        onFail: (error) => latest.current.onConnectError?.(error),
        closedError: (code) => new Error(text.current.t("terminal.connectionLost.abnormalClose", { code })),
      })
      local.connection.open()
    }

    void run().catch((error: unknown) => {
      if (local.disposed) return
      showToast({
        variant: "error",
        title: text.current.t("terminal.connectionLost.title"),
        description: error instanceof Error ? error.message : text.current.t("terminal.connectionLost.description"),
      })
      latest.current.onConnectError?.(error)
    })

    // The painted mode is a class on <html>: follow it.
    const observer = new MutationObserver(() => {
      if (!local.term) return
      const next = terminalColors(paintedMode(), readTokens())
      element.style.backgroundColor = next.background
      setOptionIfSupported(local.term, "theme", next)
      setOptionIfSupported(local.term, "colorScheme", paintedMode())
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

    return () => {
      local.disposed = true
      observer.disconnect()
      if (local.fitFrame !== undefined) cancelAnimationFrame(local.fitFrame)
      clearTimeout(local.sizeTimer)
      local.connection?.dispose()
      const finalize = () => {
        const term = local.term
        const save = latest.current.onCleanup
        if (term && local.serializer && save) {
          const buffer = (() => {
            try {
              return local.serializer.serialize({ scrollback: PERSISTED_SCROLLBACK })
            } catch {
              return ""
            }
          })()
          save({
            id,
            buffer,
            cursor: local.connection?.cursor() ?? start ?? 0,
            rows: term.rows,
            cols: term.cols,
            scrollY: term.getViewportY(),
          })
        }
        cleanups.splice(0).reverse().forEach((cleanup) => {
          try {
            cleanup()
          } catch {
            // A failed disposal must not keep the rest from running.
          }
        })
      }
      if (!local.output) return finalize()
      local.output.flush(finalize)
    }
  }, [props.pty.id, platform])

  return (
    <div
      ref={container}
      data-component="terminal"
      data-prevent-autofocus
      dir="ltr"
      tabIndex={-1}
      className="terminal-view"
      style={{ backgroundColor: colors.background, caretColor: "transparent", opacity: 0 }}
    />
  )
}
