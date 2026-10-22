// The composer of a new-session draft (#584), ported from the Solid new-session composer adapter:
// the first send asks the draft screen to create the session where the person chose (useDraft's
// start), creates it with the composer's agent, model and permission mode, and moves the prompt
// into the new session's own draft.

import { SessionID } from "@opencode/schema/session-id"
import { useEffect, useMemo, useRef } from "react"
import { useCore } from "../../react/core"
import { useDraft } from "../../new-session/context"
import { PermissionModeControl, newSessionPermissions } from "../docks/permission-mode"
import { tabKey } from "../../shell/tabs/tabs"
import { moveFollowUp, restoreFollowUp } from "../preparing/follow-up"
import { Composer } from "./composer"
import { draftRegistry } from "./draft/registry"
import { useModelSelection } from "./models/use-selection"
import type { ComposerAdapter, ComposerSession } from "./submit/submit"

export function DraftComposer() {
  const core = useCore()
  const context = useDraft()
  const server = context.server
  const host = useMemo(() => ({ storage: core.platform.storage, draftStore: core.platform.draftStore }), [core.platform])
  const registry = draftRegistry(host)
  const draft = registry.get({ type: "draft", draftID: context.draft.draftID })
  const selection = useModelSelection({ server, directory: context.directory, draftID: context.draft.draftID })
  const editor = useRef<HTMLElement | undefined>(undefined)
  const latest = useRef(context)
  latest.current = context

  useEffect(
    () =>
      context.focus.register(() =>
        requestAnimationFrame(() => {
          editor.current?.focus()
        }),
      ),
    [context.focus],
  )
  // The new-session screen opens typing: the field takes focus once its draft is loaded (Solid's
  // restoreFocus on composer ready) — unless the person is in an open popup by then (Session
  // details, a menu), which taking the focus would close.
  useEffect(() => {
    let live = true
    void draft.ready.then(() =>
      requestAnimationFrame(() => {
        if (!live || document.activeElement?.closest(popups)) return
        editor.current?.focus()
      }),
    )
    return () => {
      live = false
    }
  }, [draft])

  const session = (sessionID: string, directory: string): ComposerSession => ({
    id: sessionID,
    directory,
    api: server.api().session,
    prompt: (input) => server.data.session.prompt(input),
    setStatus: (status) => server.data.session.setStatus(sessionID, status),
    current: () => server.data.state.get().session.info[sessionID],
    admitted: (messageID) =>
      server.data.session.input.has(sessionID, messageID) || !!server.data.session.message.get(sessionID, messageID),
  })

  const adapter: ComposerAdapter = {
    kind: "new-session",
    draft,
    working: () => false,
    submitted: () => undefined,
    selection: selection.current,
    track: selection.track,
    async start(choice, submission, message) {
      const sessionID = SessionID.create()
      // A new worktree comes first: the session's tab shows the prompt while it is made (#584).
      const preparing = latest.current.workspace.value === "create"
      const pendingKey = tabKey({ type: "session", server: context.draft.server, sessionId: sessionID })
      if (preparing)
        server.data.session.stage({
          sessionID,
          id: message.id,
          text: message.text,
          metadata: message.metadata as Parameters<typeof server.data.session.stage>[0]["metadata"],
        })
      const started = await latest.current.start({
        sessionID,
        message,
        create: async (directory) => {
          const created = server.data.session.create({
            id: sessionID,
            agent: choice.agent,
            model: { id: choice.model.modelID, providerID: choice.model.providerID, variant: choice.variant },
            location: { directory },
            // Buff (#450): a new session starts in the permission mode chosen in the composer.
            permissions: newSessionPermissions(choice.agent),
          })
          await created.request
        },
      })
      if (!started) {
        if (!preparing) return
        server.data.session.unstage(sessionID, message.id)
        restoreFollowUp(pendingKey, draft)
        return
      }
      selection.promote(started.directory, sessionID)
      const target = registry.get({ type: "session", scope: core.scope(server.key), directory: started.directory, sessionID })
      submission.retarget(target, { preserveDraft: !!started.complete })
      const complete = started.complete
      return {
        session: session(sessionID, started.directory),
        // The session takes over from its preparing tab: the follow-up written meanwhile comes along.
        complete:
          complete &&
          (async () => {
            moveFollowUp(pendingKey, target)
            await complete()
          }),
        discard: preparing ? () => server.data.session.unstage(sessionID, message.id) : undefined,
      }
    },
  }

  return (
    <Composer
      server={server}
      directory={context.directory}
      draft={draft}
      selection={selection}
      adapter={adapter}
      working={false}
      beforeModel={<PermissionModeControl selection={selection} server={server} />}
      onEditor={(element) => {
        editor.current = element
      }}
    />
  )
}

const popups = '[role="dialog"], [role="menu"], [role="listbox"], [aria-expanded="true"]'
