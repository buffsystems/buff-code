// The terminal's commands (#584), registered while the session screen is shown: toggle the pane
// (ctrl+`, /terminal), open a new terminal, close the focused one — the Solid session commands.

import { useEffect } from "react"
import { useCommandRegistration } from "../../../commands/provider"
import { useI18n } from "../../../i18n/provider"
import { useSessionView } from "../../context"
import { useWorkspaceTerminals } from "./use-terminals"

export function useTerminalCommands() {
  const i18n = useI18n()
  const view = useSessionView()
  const { terminals } = useWorkspaceTerminals()
  const viewCategory = i18n.t("command.category.view")
  const terminalCategory = i18n.t("command.category.terminal")

  // Focus moving anywhere outside the pane drops a pending request to focus a terminal, so a
  // terminal that finishes mounting later never takes the focus back.
  useEffect(() => {
    if (!terminals) return
    const cancel = (event: FocusEvent) => {
      if (!terminals.focus.get() || !(event.target instanceof Element)) return
      if (event.target.closest("#terminal-panel")) return
      terminals.cancelFocus()
    }
    document.addEventListener("focusin", cancel)
    return () => document.removeEventListener("focusin", cancel)
  }, [terminals])

  // Read the stored state, not the rendered one: two quick presses would otherwise both see the
  // pane as it was painted (the view updates as a transition) and the second one would be lost.
  const toggle = () => {
    if (view.terminalOpen()) {
      terminals?.cancelFocus()
      return view.closeTerminal()
    }
    view.openTerminal()
    terminals?.requestFocus(terminals.state.get().active)
  }

  const create = () => {
    view.openTerminal()
    if (!terminals) return
    if (terminals.state.get().all.length > 0) return terminals.create()
    terminals.requestFocus()
  }

  const close = () => {
    const id = terminals?.state.get().active
    if (!terminals || !id) return
    const last = terminals.state.get().all.length === 1
    void terminals.close(id)
    if (last) view.closeTerminal()
  }

  useCommandRegistration("session.terminal", () => [
    {
      id: "terminal.toggle",
      title: i18n.t("command.terminal.toggle"),
      category: viewCategory,
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: toggle,
    },
    {
      id: "terminal.close",
      title: i18n.t("terminal.close"),
      category: terminalCategory,
      keybind: "mod+w",
      hidden: true,
      when: (event) => event.target instanceof Element && !!event.target.closest('[data-component="terminal"]'),
      onSelect: close,
    },
    {
      id: "terminal.new",
      title: i18n.t("command.terminal.new"),
      description: i18n.t("command.terminal.new.description"),
      category: terminalCategory,
      keybind: "ctrl+alt+t",
      onSelect: create,
    },
  ])
}
