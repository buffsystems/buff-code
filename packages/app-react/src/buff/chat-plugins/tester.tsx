// The live test of a chat plugin, on the window's side (#595, #984). While `chat_plugin_test`
// runs, its call carries the examples to draw; the window draws each in a real frame, off screen,
// and tells the engine what happened — drawn, with its height, or the error the view threw. The
// model then knows whether the plugin works in the person's app, not in its imagination.

import { PluginFrame, type ChatPluginsHost } from "@buff/ui/react"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { useRef } from "react"

/** A running test: the call that asked for it and what to draw. */
export type PendingTest = { call: string; test: BuffChatPlugin.Test }

type Part = { type: string; id?: string; name?: string; state?: { status?: string; metadata?: unknown } }

/** The tests still running in a chat's messages. */
export function pendingTests(messages: readonly object[]): PendingTest[] {
  return messages.flatMap((message) => {
    const content = "content" in message ? message.content : undefined
    return (Array.isArray(content) ? (content as Part[]) : []).flatMap((part) => {
      if (part.type !== "tool" || part.name !== BuffChatPlugin.TOOLS.test || !part.id) return []
      if (part.state?.status !== "running" && part.state?.status !== "pending") return []
      const test = BuffChatPlugin.testOf(part.state?.metadata)
      return test ? [{ call: part.id, test }] : []
    })
  })
}

export function PluginTester(props: {
  tests: readonly PendingTest[]
  /** What the frames need of the window; the view is read by the plugin's id and version. */
  host: Pick<ChatPluginsHost, "view" | "locale">
  report: (input: { call: string; example: string; ok: boolean; error?: string; height?: number }) => void
}) {
  // An example is answered for once, whatever the frame says after.
  const told = useRef(new Set<string>())
  const tell = (call: string, example: string, result: { ok: boolean; error?: string; height?: number }) => {
    const key = `${call}:${example}`
    if (told.current.has(key)) return
    told.current.add(key)
    props.report({ call, example, ...result })
  }
  const host: ChatPluginsHost = {
    blocks: {},
    locale: props.host.locale,
    view: props.host.view,
    // A test draws; it sends nothing anywhere.
    sendMessage: () => Promise.reject(new Error("A plugin under test sends no messages.")),
  }
  return (
    <div
      aria-hidden="true"
      // Off screen but laid out at a chat's width: a frame measures what it draws.
      style={{ position: "fixed", left: -10000, top: 0, width: 640, visibility: "hidden", pointerEvents: "none" }}
    >
      {props.tests.flatMap(({ call, test }) =>
        test.examples.map((example) => (
          <PluginFrame
            key={`${call}:${test.version}:${example.name}`}
            plugin={{ id: test.id, version: test.version, name: test.name }}
            host={host}
            block={{ name: example.block, text: example.text, complete: true }}
            onRendered={(height) =>
              tell(
                call,
                example.name,
                height === 0
                  ? { ok: false, error: "The view drew nothing: its content is 0 px high." }
                  : { ok: true, ...(height === undefined ? {} : { height }) },
              )
            }
            onFailure={(detail) => tell(call, example.name, { ok: false, error: detail })}
            failure={() => null}
          />
        )),
      )}
    </div>
  )
}
