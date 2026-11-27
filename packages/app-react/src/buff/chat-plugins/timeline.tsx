// Chat plugins in the developer timeline (#595, #981). The timeline's Markdown is patched in
// place by its own controller, so the frames are mounted from outside it: after every paint the
// code blocks are looked over, and each one a plugin draws gets a mount with the plugin's frame
// in it. The code block itself stays in the page, hidden, and comes back if the plugin fails.

import "./chat-plugins.css"
import { PluginFrame, useChatPlugins, type ChatPluginsHost } from "@buff/ui/react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

type Slot = { mount: HTMLElement; wrapper: HTMLElement; name: string; text: string; complete: boolean }

const MOUNT = "markdown-plugin"
const mountOf = (wrapper: HTMLElement) =>
  [...wrapper.children].find((child): child is HTMLElement => child.getAttribute("data-component") === MOUNT)

/** The code blocks of `root` that plugins draw, each with its mount; the rest are left as code. */
export function pluginSlots(root: HTMLElement, host: ChatPluginsHost | null): Slot[] {
  const slots: Slot[] = []
  root.querySelectorAll<HTMLElement>('[data-component="markdown-code"]').forEach((wrapper) => {
    // `named` is what the answer called the block; `language` is what the highlighter made of it.
    const name = wrapper.dataset.named ?? wrapper.dataset.language ?? ""
    const drawn = !!host && Object.hasOwn(host.blocks, name)
    if (!drawn || wrapper.dataset.plugin === "failed") {
      if (!drawn) delete wrapper.dataset.plugin
      mountOf(wrapper)?.remove()
      return
    }
    const mount = mountOf(wrapper) ?? wrapper.appendChild(document.createElement("div"))
    mount.setAttribute("data-component", MOUNT)
    wrapper.dataset.plugin = "true"
    slots.push({
      mount,
      wrapper,
      name,
      text: wrapper.querySelector("code")?.textContent ?? "",
      complete: wrapper.closest<HTMLElement>("[data-markdown-block]")?.dataset.markdownComplete !== "false",
    })
  })
  return slots
}

const same = (left: Slot[], right: Slot[]) =>
  left.length === right.length &&
  left.every((slot, index) => {
    const other = right[index]!
    return slot.mount === other.mount && slot.text === other.text && slot.complete === other.complete
  })

/**
 * The frames of one Markdown text: `scan` is called with the text's element after each paint,
 * `frames` goes into the React tree beside it. `textKey` names the text among the chat's texts.
 */
export function usePluginFrames(textKey: string | undefined): { scan: (root: HTMLElement) => void; frames: ReactNode } {
  const host = useChatPlugins()
  const live = useRef(host)
  live.current = host
  const root = useRef<HTMLElement>(undefined)
  const [slots, setSlots] = useState<Slot[]>([])
  const scan = useCallback((element: HTMLElement) => {
    root.current = element
    const next = pluginSlots(element, live.current)
    setSlots((before) => (same(before, next) ? before : next))
  }, [])
  // Plugins switched on or off while the text stands still: look the blocks over again.
  const drawn = host ? Object.keys(host.blocks).sort().join(" ") : ""
  useEffect(() => {
    if (root.current) scan(root.current)
  }, [drawn, scan])

  const frames =
    host &&
    slots.map((slot, n) => {
      const plugin = host.blocks[slot.name]
      if (!plugin || !slot.mount.isConnected) return null
      return createPortal(
        <PluginFrame
          plugin={plugin}
          host={host}
          block={{ name: slot.name, text: slot.text, complete: slot.complete }}
          {...(textKey ? { frameKey: `${textKey}:${n}` } : {})}
          onFailure={() => {
            // The code block shows itself again; the next look-over takes the mount away.
            slot.wrapper.dataset.plugin = "failed"
            if (root.current) scan(root.current)
          }}
          failure={() => null}
        />,
        slot.mount,
        `${slot.name}:${n}`,
      )
    })
  return { scan, frames }
}
