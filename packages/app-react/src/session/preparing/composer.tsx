// The composer while a session is being prepared (#584), ported from the Solid PreparingComposer:
// the person can write the next message, which waits in memory (follow-up.ts) — nothing is sent,
// the model controls are hidden. When the session takes over, the caret moves to its composer.

import { setCursorPosition } from "@opencode/app/react-reuse/composer-dom"
import { composerPlaceholder } from "@opencode/app/react-reuse/composer-placeholder"
import { useEffect, useLayoutEffect, useMemo } from "react"
import { formatKeybind } from "../../commands/keybind"
import { useI18n } from "../../i18n/provider"
import { useHistory } from "../../router/router"
import { createComposerController } from "../composer/editor/controller"
import { ComposerView } from "../composer/view/composer"
import { followUpDraft } from "./follow-up"

const none = { options: [], current: "default", onSelect: () => undefined }

export function PreparingComposer(props: { tabKey: string }) {
  const i18n = useI18n()
  const history = useHistory()
  const draft = followUpDraft(props.tabKey)
  const controller = useMemo(
    () =>
      createComposerController(draft, () => ({
        commands: () => [],
        context: () => [],
        searchContextFiles: () => [],
        attach: () => undefined,
        draftOnly: true,
        submit: { available: () => false, working: () => false, onSubmit: () => undefined, onStop: () => undefined },
      })),
    [draft],
  )
  useEffect(() => controller.connect(), [controller])
  // A layout effect: its cleanup runs while the editor is still in the page and focused.
  useLayoutEffect(() => {
    const editor = controller.editor()
    if (!editor) return
    editor.focus()
    setCursorPosition(editor, draft.cursor() ?? 0)
    // The session's composer takes the focus and the caret from here.
    return () => {
      if (document.activeElement !== editor) return
      const cursor = draft.cursor() ?? 0
      const path = history.location.get().pathname
      requestAnimationFrame(() => {
        if (history.location.get().pathname !== path) return
        const next = document.querySelector<HTMLElement>('[data-component="composer-editor"]')
        if (!next || next === editor) return
        next.focus()
        setCursorPosition(next, cursor)
      })
    }
  }, [controller, draft, history])
  const placeholder = composerPlaceholder(
    "normal",
    (key, params) => i18n.t(key as Parameters<typeof i18n.t>[0], params),
    true,
  )
  return (
    <ComposerView
      controller={controller}
      placeholder={placeholder}
      available={false}
      working={false}
      variant={none}
      borderUnderlay
      keys={{
        attach: [],
        attachShortcut: formatKeybind("mod+u", i18n.t),
        agent: [],
        variant: [],
        alternate: [],
        exitShell: [formatKeybind("esc", i18n.t)],
      }}
      onStop={() => undefined}
    />
  )
}
