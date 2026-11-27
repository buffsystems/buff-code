// Chat plugins in settings (#595, #986): what draws code blocks as visuals in this person's
// chats — built in, their own for every project, their own for this project — each with what
// it is for, an example drawn in place, a switch, and «delete» for their own. A plugin switched
// off stays on disk: its blocks are plain code again and the model no longer knows of it.

import "./settings.css"
import { Button, Dialog, DialogBody, Panel, PluginFrame, Switch, type ChatPluginsHost } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { useEffect, useState } from "react"
import type { Server } from "../../core/servers"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { Problem } from "./kit"
import { at, useBuffList } from "./rpc"

const GROUPS: readonly BuffChatPlugin.Origin[] = ["local", "user", "builtin"]
const GROUP_TITLE: Record<BuffChatPlugin.Origin, string> = {
  local: "Your chat plugins — in this project only",
  user: "Your chat plugins — in all projects",
  builtin: "Built-in chat plugins",
}

/** The plugins by where they are kept, in the order a person owns them; empty groups are left out. */
export function pluginGroups(plugins: readonly BuffChatPlugin.Entry[]) {
  return GROUPS.flatMap((origin) => {
    const own = plugins.filter((plugin) => plugin.origin === origin)
    return own.length ? [{ origin, plugins: own }] : []
  })
}

function useController(server: Server, directory: string | undefined) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const rpc = server.api().rpc(BuffChatPlugin.Rpc)
  const empty: { plugins: readonly BuffChatPlugin.Entry[] } = { plugins: [] }
  const list = useBuffList({
    server,
    name: "chat-plugins",
    directory,
    empty,
    load: () => rpc.list(undefined, at(directory)),
    subscribe: (signal) => rpc.events.subscribe("changed", { signal }),
    failure: t("Could not read the chat plugins."),
  })
  const failed = (error: unknown) =>
    showToast({ title: t("Chat plugins"), description: formatServerError(error, undefined, t("Could not save.")) })
  return {
    // Shown in the person's language where the plugin names itself in it.
    plugins: list.value.plugins.map((entry) => BuffChatPlugin.localized(entry, i18n.buff.locale)),
    problem: list.problem,
    enable: (entry: BuffChatPlugin.Entry, enabled: boolean) =>
      rpc.enable({ id: entry.id, enabled }, at(directory)).then(list.settle, failed),
    remove: (entry: BuffChatPlugin.Entry) => rpc.remove({ id: entry.id }, at(directory)).then(list.settle, failed),
    view: (id: string) => rpc.view({ id }, at(directory)).then((answer) => answer.html),
    example: (id: string, name: string) => rpc.example({ id, name }, at(directory)),
  }
}
type Controller = ReturnType<typeof useController>

/** An example of the plugin drawn as it is drawn in a chat — the same frame, nothing sent anywhere. */
function ExampleDialog(props: { entry: BuffChatPlugin.Entry; controller: Controller; onClose: () => void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const [shown, setShown] = useState(props.entry.examples[0])
  const [block, setBlock] = useState<{ name: string; text: string }>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    if (!shown) return
    let current = true
    setBlock(undefined)
    setProblem(undefined)
    props.controller.example(props.entry.id, shown).then(
      (got) => current && setBlock({ name: got.block, text: got.text }),
      (error: unknown) => current && setProblem(formatServerError(error, undefined, t("Could not open the example."))),
    )
    return () => {
      current = false
    }
  }, [shown])
  const host: ChatPluginsHost = {
    blocks: {},
    locale: i18n.buff.locale,
    view: (plugin) => props.controller.view(plugin.id),
    // An example in settings talks to no chat.
    sendMessage: () => Promise.reject(new Error(t("This is an example: it sends nothing."))),
  }
  return (
    <Dialog
      open
      size="lg"
      title={t("«{name}»: an example", { name: props.entry.name })}
      closeLabel={i18n.t("common.close")}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogBody>
        <div className="flex flex-col gap-3" data-component="buff-chat-plugin-example">
          {props.entry.examples.length > 1 && (
            <div className="ui-chip-row">
              {props.entry.examples.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="ui-chip"
                  aria-pressed={name === shown}
                  onClick={() => setShown(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <Problem text={problem} />
          {block && (
            <PluginFrame
              key={`${props.entry.version}:${shown}`}
              plugin={{
                id: props.entry.id,
                version: props.entry.version,
                name: props.entry.name,
                ...(props.entry.height ? { height: props.entry.height } : {}),
              }}
              host={host}
              block={{ name: block.name, text: block.text, complete: true }}
            />
          )}
        </div>
      </DialogBody>
    </Dialog>
  )
}

function PluginRow(props: { entry: BuffChatPlugin.Entry; controller: Controller }) {
  const t = useI18n().buff.t
  const dialog = useDialog()
  const { entry } = props
  const remove = () =>
    void confirm(dialog, {
      title: t("Delete the chat plugin «{name}»?", { name: entry.name }),
      text: t("Its folder is deleted; blocks it drew become plain code again."),
      action: t("Delete"),
      cancel: t("Cancel"),
      danger: true,
    }).then((yes) => {
      if (yes) void props.controller.remove(entry)
    })
  return (
    <div className="buff-settings-row" data-component="buff-chat-plugin-row" data-plugin={entry.id}>
      <div className="buff-settings-lead">
        <div className={entry.enabled && !entry.problem ? "buff-settings-copy" : "buff-settings-copy opacity-60"}>
          <span className="buff-settings-name truncate">
            {entry.name}
            <span className="buff-settings-note font-mono">
              {" "}
              {entry.blocks.map((block) => "```" + block).join(" ")}
            </span>
          </span>
          <span className="buff-settings-note">{entry.description}</span>
          {entry.problem && <span className="buff-settings-note text-destructive">{entry.problem}</span>}
          {!entry.enabled && !entry.problem && (
            <span className="buff-settings-note">
              {t("Turned off: its blocks are shown as code, and the model does not know of it.")}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {entry.examples.length > 0 && !entry.problem && (
          <Button
            variant="ghost"
            size="sm"
            data-action="buff-chat-plugin-example"
            onClick={() =>
              dialog.show((close) => <ExampleDialog entry={entry} controller={props.controller} onClose={close} />)
            }
          >
            {t("Example")}
          </Button>
        )}
        {entry.origin !== "builtin" && (
          <Button variant="ghost" size="sm" data-action="buff-chat-plugin-remove" onClick={remove}>
            {t("Delete")}
          </Button>
        )}
        <Switch
          aria-label={entry.name}
          checked={entry.enabled}
          disabled={!!entry.problem}
          onCheckedChange={(enabled) => void props.controller.enable(entry, enabled)}
        />
      </div>
    </div>
  )
}

export function BuffChatPluginSection(props: { server: Server; directory?: string }) {
  const t = useI18n().buff.t
  const controller = useController(props.server, props.directory)
  const groups = pluginGroups(controller.plugins)
  return (
    <div className="flex flex-col gap-6" data-component="buff-chat-plugin-section">
      <span className="ui-note">
        {t(
          "A chat plugin draws a block of an answer as a visual — a chart, a diagram, a board. To get a new one, open Self-setup and say what you want to see: the agent makes the plugin, tests it and shows you.",
        )}
      </span>
      <Problem text={controller.problem} />
      {groups.map((group) => (
        <div key={group.origin} className="settings-section">
          <span className="settings-section-title">{t(GROUP_TITLE[group.origin])}</span>
          <Panel data-component="settings-list" data-variant="catalog">
            {group.plugins.map((entry) => (
              <PluginRow key={entry.id} entry={entry} controller={controller} />
            ))}
          </Panel>
        </div>
      ))}
    </div>
  )
}
