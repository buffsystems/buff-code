// The terminal pane (#584): the bottom region's strip of the workspace's terminals and their
// screens. Opening it with no terminal starts one; closing the last one closes the region. A screen
// once shown stays mounted (hidden) while another tab or workspace is shown, so switching never
// reconnects or repaints it — the Solid panel's surface cache.

import { IconButton, TabStrip, Tooltip } from "@buff/ui/react"
import { DragDropProvider, PointerSensor } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { Plus } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { useCommands } from "../../../commands/provider"
import { formatKeybind } from "../../../commands/keybind"
import { useI18n } from "../../../i18n/provider"
import { useSession, useSessionView } from "../../context"
import { TerminalSurface, useSessionRegions } from "../../regions"
import { focusTerminalById } from "./focus"
import type { Server } from "../../../core/servers"
import type { LocalPTY } from "./state"
import { TerminalTab } from "./tab"
import type { WorkspaceTerminals } from "./terminals"
import { useWorkspaceTerminals } from "./use-terminals"
import { TerminalView } from "./view"
import "./terminal.css"

const MAX_CACHED_WORKSPACES = 20

type Surface = {
  key: string
  workspace: string
  directory: string
  server: Server
  pty: LocalPTY
  terminals: WorkspaceTerminals
}

export function TerminalPanel() {
  const i18n = useI18n()
  const region = useSessionRegions().terminal
  return (
    <TerminalSurface label={i18n.t("terminal.title")}>
      <TerminalContent
        opened={region.opened}
        present={region.opened || region.present}
        reserveReviewToggle={region.reserveReviewToggle}
      />
    </TerminalSurface>
  )
}

// Apart from the surface: the surface follows the frame's sizes, the contents only their own state.
const TerminalContent = memo(function TerminalContent(props: {
  opened: boolean
  present: boolean
  reserveReviewToggle: boolean
}) {
  const i18n = useI18n()
  const commands = useCommands()
  const session = useSession()
  const view = useSessionView()
  const present = props.present
  const { terminals, directory, workspace, state, ready, focus } = useWorkspaceTerminals()
  const [surfaces, setSurfaces] = useState<Surface[]>([])
  const autoCreated = useRef<string | undefined>(undefined)
  const previous = useRef<{ workspace?: string; count: number }>({ count: 0 })
  const recovered = useRef(new Set<string>())
  const active = state.active
  const count = state.all.length

  // An open pane with no terminal starts one, once per workspace.
  useEffect(() => {
    if (!props.opened) {
      autoCreated.current = undefined
      return
    }
    if (!terminals || !workspace || !ready || count !== 0 || autoCreated.current === workspace) return
    autoCreated.current = workspace
    terminals.create()
  }, [props.opened, terminals, workspace, ready, count])

  // The last terminal of a workspace closed: close the pane.
  useEffect(() => {
    const before = previous.current
    previous.current = { workspace, count }
    if (before.workspace === workspace && before.count > 0 && count === 0) view.closeTerminal()
  }, [workspace, count, view])

  // Mount the active terminal's screen, drop screens of closed PTYs, keep at most 20 workspaces.
  useEffect(() => {
    if (!terminals || !workspace || !directory || !ready) return
    setSurfaces((current) => {
      const ids = new Set(state.all.map((pty) => pty.id))
      const kept = current.filter((surface) => surface.workspace !== workspace || ids.has(surface.pty.id))
      const pty = state.all.find((item) => item.id === active)
      const key = pty ? `${workspace}\0${pty.id}` : undefined
      const added = pty && key && !kept.some((surface) => surface.key === key)
      const next = added ? [...kept, { key, workspace, directory, server: session.server, pty, terminals }] : kept
      const order = [...new Set([...next.map((surface) => surface.workspace).filter((item) => item !== workspace), workspace])]
      const keep = new Set(order.slice(-MAX_CACHED_WORKSPACES))
      const pruned = next.filter((surface) => keep.has(surface.workspace))
      return pruned.length === current.length && pruned.every((surface, index) => surface === current[index])
        ? current
        : pruned
    })
  }, [terminals, workspace, directory, ready, state.all, active, session.server])

  // A pending focus request lands on the active terminal once it is shown.
  const requested = !!active && !!terminals?.focusRequested(active)
  useEffect(() => {
    if (!active || !requested || !terminals) return
    const frame = requestAnimationFrame(() => {
      if (terminals.state.get().active === active && terminals.focusRequested(active)) focusTerminalById(active)
    })
    return () => cancelAnimationFrame(frame)
  }, [active, requested, terminals, focus])

  const newKeybind = commands.keybind("terminal.new")
  const newLabel = i18n.t("command.terminal.new")
  const label = i18n.t("terminal.title")
  const loading = !ready && surfaces.length === 0

  return (
    <div className="terminal-panel" data-reserve-toggle={props.reserveReviewToggle || undefined}>
      {loading && (
        <div className="terminal-panel__loading">
          <div className="terminal-panel__bar">
            <span className="ui-note">
              {i18n.t("common.loading")}
              {i18n.t("common.loading.ellipsis")}
            </span>
          </div>
          <div className="terminal-panel__placeholder ui-note">{i18n.t("terminal.loading")}</div>
        </div>
      )}
      {!loading && terminals && (
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
              preventActivation: (event) =>
                event.target instanceof Element &&
                !!event.target.closest('.ui-tab-strip__close, input, [contenteditable="true"]'),
            }),
          ]}
          modifiers={[RestrictToHorizontalAxis]}
          onDragEnd={(event) => {
            const source = event.operation.source
            if (!event.canceled && isSortable(source) && source.initialIndex !== source.index)
              terminals.move(source.id.toString(), source.index)
            const id = terminals.state.get().active
            if (id) requestAnimationFrame(() => terminals.state.get().active === id && focusTerminalById(id))
          }}
        >
          <div className="terminal-panel__bar">
            <TabStrip
              label={label}
              className="terminal-panel__tabs"
              onPointerDown={(event) => {
                const focused = document.activeElement
                if (event.target === focused) return
                if (focused instanceof HTMLInputElement && event.currentTarget.contains(focused)) focused.blur()
              }}
            >
              {state.all.map((pty, index) => (
                <TerminalTab
                  key={pty.id}
                  pty={pty}
                  index={index}
                  active={pty.id === active}
                  terminals={terminals}
                  count={count}
                  onLastClosed={view.closeTerminal}
                />
              ))}
              <Tooltip
                side="bottom"
                content={newKeybind ? `${newLabel} ${formatKeybind(newKeybind, i18n.t)}` : newLabel}
              >
                <IconButton icon={Plus} size="sm" aria-label={newLabel} onClick={() => terminals.create()} />
              </Tooltip>
            </TabStrip>
          </div>
          <div className="terminal-panel__screens">
            {surfaces.map((surface) => (
              <div
                key={surface.key}
                id={`terminal-wrapper-${surface.pty.id}`}
                role="tabpanel"
                aria-labelledby={`terminal-tab-${surface.pty.id}`}
                className="terminal-panel__screen"
                hidden={!present || surface.workspace !== workspace || surface.pty.id !== active}
              >
                <TerminalView
                  pty={surface.pty}
                  server={surface.server}
                  directory={surface.directory}
                  autoFocus={surface.terminals.focusRequested(surface.pty.id)}
                  onAutoFocus={() => {
                    focusTerminalById(surface.pty.id)
                    surface.terminals.consumeFocus(surface.pty.id)
                  }}
                  onConnect={() => {
                    recovered.current.delete(surface.key)
                    surface.terminals.trim(surface.pty.id)
                    if (surface.terminals.state.get().active !== surface.pty.id) return
                    if (!surface.terminals.focusRequested(surface.pty.id)) return
                    focusTerminalById(surface.pty.id)
                    surface.terminals.consumeFocus(surface.pty.id)
                  }}
                  onCleanup={(pty) => surface.terminals.update(pty)}
                  onConnectError={() => {
                    // A dead PTY is replaced once; the fresh one gets its own chance.
                    if (recovered.current.has(surface.key)) return
                    recovered.current.add(surface.key)
                    void surface.terminals.clone(surface.pty.id)
                  }}
                />
              </div>
            ))}
          </div>
        </DragDropProvider>
      )}
    </div>
  )
})
