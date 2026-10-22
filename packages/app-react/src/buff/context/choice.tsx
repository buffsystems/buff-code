// Choosing Buff's working context (#391, #470), ported from the Solid window's context-chip.tsx
// choice: the organization, the project and the knowledge spaces from the lists allowed — the same
// steps as in the terminal (`buff-context-flow`) — and signing in when needed. The context chip,
// the «no model» strip and the providers settings use it.

import { CommandList, Dialog, DialogBody } from "@buff/ui/react"
import { BuffContext } from "@opencode/schema/buff-context"
import { chooseOrg, chooseProject, chooseSpaces, type AskOption } from "@opencode/schema/buff-context-flow"
import { useEffect, useState } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { showToast } from "../../shell/notifications/toast"
import { openBuffSignIn } from "../../providers/connect/open"

type Choice = BuffContext.Choice

const message = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)

export function useBuffContextChoice(server: Server, directory: string) {
  const dialog = useDialog()
  const i18n = useI18n()
  const t = i18n.buff.t
  const rpc = server.api().rpc(BuffContext.Rpc)
  const at = { location: { directory } }

  function ask<Value>(input: {
    readonly title: string
    readonly options: readonly AskOption<Value>[]
    readonly current?: Value
    readonly empty?: string
  }) {
    return new Promise<Value | undefined>((resolve) => {
      const settled = { done: false }
      const settle = (value: Value | undefined) => {
        if (settled.done) return
        settled.done = true
        resolve(value)
      }
      const current = input.options.findIndex((option) => option.value === input.current)
      dialog.show((close) => (
        <Dialog
          open
          title={input.title}
          closeLabel={i18n.t("common.close")}
          onOpenChange={(open) => {
            if (open) return
            close()
            settle(undefined)
          }}
        >
          <DialogBody>
            <CommandList
              autoFocus
              label={input.title}
              placeholder={t("Search")}
              emptyText={input.empty ?? t("Empty")}
              current={current === -1 ? undefined : String(current)}
              items={input.options.map((option, index) => ({
                value: String(index),
                label: option.title,
                description: option.description,
              }))}
              onSelect={(item) => {
                close()
                settle(input.options[Number(item.value)]?.value)
              }}
            />
          </DialogBody>
        </Dialog>
      ))
    })
  }

  /** The kept context, or undefined when the choice was cancelled or failed (a toast says why). */
  const choose = async (current: Choice | null): Promise<Choice | undefined> => {
    try {
      const options = await rpc.options(undefined, at)
      const org = await chooseOrg(ask, options, current, t)
      if (org === undefined) return undefined
      const project = await chooseProject(ask, options, org, BuffContext.preselectProject(current, org), t)
      if (project === undefined) return undefined
      const spaces = await chooseSpaces(ask, options, org, current?.org === org ? (current?.spaces ?? []) : [], t)
      if (spaces === undefined) return undefined
      const kept = await rpc.set({ org, project, spaces }, at)
      showToast({ title: t("Buff context"), description: BuffContext.label(kept, t) })
      return kept
    } catch (error) {
      showToast({ title: t("Buff context"), description: message(error) })
      return undefined
    }
  }

  const signIn = (onClose?: () => void) => openBuffSignIn(dialog, { server, directory, onClose })

  return { rpc, at, choose, signIn }
}

/** A directory's chosen context, following changes from elsewhere; undefined while unknown. */
export function useBuffContextValue(server: Server, directory: string) {
  const connected = useConnection(server).status === "connected"
  const [choice, setChoice] = useState<Choice | null>()
  useEffect(() => {
    if (!connected) return
    const rpc = server.api().rpc(BuffContext.Rpc)
    void rpc.get(undefined, { location: { directory } }).then(setChoice, () => setChoice(null))
    return rpc.events.on("changed", (event) => {
      if (event.location?.directory === directory) setChoice(event.data)
    })
  }, [connected, server, directory])
  return [choice, setChoice] as const
}
