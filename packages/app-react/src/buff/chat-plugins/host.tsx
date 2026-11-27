// Chat plugins in the window (#595, #981): which plugin draws which block of this chat, the
// plugin's view, and what a plugin may do through the window — send a message into the chat as
// the person, tell the model its state, open an address after the person agreed. The frames
// themselves are @buff/ui's; this is what the window gives them.

import { ChatPluginsProvider, type ChatPluginRef, type ChatPluginsHost } from "@buff/ui/react"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { useCallback, useMemo, useRef, type ReactNode } from "react"
import type { Server } from "../../core/servers"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useServerData } from "../../react/core"
import { at, useBuffList } from "../settings/rpc"
import { pendingTests, PluginTester } from "./tester"

const empty: { plugins: readonly BuffChatPlugin.Entry[] } = { plugins: [] }
const none: never[] = []

/** Views by server, plugin and version: a view is read once for all the frames that show it. */
const views = new Map<string, Promise<string>>()

/** The plugin that draws each block: enabled plugins only, one owner per block. */
export function blocksOf(entries: readonly BuffChatPlugin.Entry[]): Record<string, ChatPluginRef> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return Object.fromEntries(
    Object.entries(BuffChatPlugin.owners(entries)).flatMap(([block, id]) => {
      const entry = byId.get(id)
      return entry
        ? [[block, { id, version: entry.version, name: entry.name, ...(entry.height ? { height: entry.height } : {}) }]]
        : []
    }),
  )
}

export function ChatPlugins(props: {
  server: Server
  sessionID: string
  directory: string
  /** A chat that is only read (a helper's): its visuals show, and send nothing. */
  readOnly?: boolean
  children: ReactNode
}) {
  const i18n = useI18n()
  const dialog = useDialog()
  const platform = usePlatform()
  const { server, sessionID, directory } = props
  const rpc = server.api().rpc(BuffChatPlugin.Rpc)
  const list = useBuffList({
    server,
    name: "chat-plugins",
    directory,
    empty,
    load: () => rpc.list(undefined, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
  })
  // A plugin being tested by Self-setup (#984): its examples are drawn here and answered for.
  const messages = useServerData(server, (state) => state.session.message[sessionID] ?? none)
  const tests = useMemo(() => pendingTests(messages), [messages])
  const live = useRef({ rpc, dialog, platform, t: i18n.buff.t, readOnly: props.readOnly })
  live.current = { rpc, dialog, platform, t: i18n.buff.t, readOnly: props.readOnly }
  // The frames redraw when the set of plugins or their versions change, not on every read.
  const stamp = list.value.plugins.map((entry) => `${entry.id}:${entry.version}:${entry.enabled}`).join(" ")
  const view = useCallback(
    (plugin: ChatPluginRef) => {
      const key = `${server.key}:${plugin.id}:${plugin.version}`
      const cached = views.get(key)
      if (cached) return cached
      const loading = live.current.rpc.view({ id: plugin.id }, at(directory)).then((answer) => {
        // The folder changed since this version was named: what came is another view.
        if (answer.version !== plugin.version) views.delete(key)
        return answer.html
      })
      views.set(key, loading)
      loading.catch(() => views.delete(key))
      return loading
    },
    [server, directory],
  )
  const host = useMemo<ChatPluginsHost | null>(() => {
    // A frame is named — for a screen reader, in its states — in the person's language.
    const blocks = blocksOf(list.value.plugins.map((entry) => BuffChatPlugin.localized(entry, i18n.buff.locale)))
    if (!directory || !Object.keys(blocks).length) return null
    return {
      blocks,
      locale: i18n.buff.locale,
      view,
      sendMessage: async (text) => {
        if (live.current.readOnly) throw new Error(live.current.t("This chat is only read."))
        await server.data.session.prompt({ sessionID, text })
      },
      setContext: (frame, text, plugin) =>
        void live.current.rpc
          .context({ session: sessionID, frame, id: plugin.id, ...(text ? { text } : {}) }, at(directory))
          .catch(() => undefined),
      openLink: async (url) => {
        const t = live.current.t
        const agreed = await confirm(live.current.dialog, {
          title: t("Open the address?"),
          text: url,
          action: t("Open"),
          cancel: t("Cancel"),
        })
        if (agreed) live.current.platform.openExternal(url)
        return agreed
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for the list
  }, [server, sessionID, directory, stamp, i18n.buff.locale, view])
  return (
    <ChatPluginsProvider host={host}>
      {props.children}
      {tests.length > 0 && directory && (
        <PluginTester
          tests={tests}
          host={{ view, locale: i18n.buff.locale }}
          report={(input) =>
            void live.current.rpc.report({ session: sessionID, ...input }, at(directory)).catch(() => undefined)
          }
        />
      )}
    </ChatPluginsProvider>
  )
}
