// One workspace's terminals (#584): the PTY list persisted where the Solid window keeps it (the
// workspace namespace, `workspace:terminal`), created, renamed, closed and recovered through the
// server, and the pending focus request a new terminal carries until it mounts. Terminals belong to
// the workspace, so they live on while the window switches between its sessions.

import type { OpenCodeClient } from "@opencode/client/promise"
import { defaultTitle } from "@opencode/app/react-reuse/terminal-title"
import { createPersisted } from "../../../core/persisted"
import { createStore } from "../../../core/store"
import type { EventStream } from "../../../core/events"
import type { PlatformStorage } from "../../../platform/platform"
import {
  addTerminal,
  closeTerminal,
  cycleTerminal,
  decodeTerminals,
  moveTerminal,
  nextTerminalNumber,
  removeExited,
  replaceTerminal,
  trimTerminal,
  updateTerminal,
  EMPTY_TERMINALS,
  type LocalPTY,
  type TerminalState,
} from "./state"

export type FocusRequest = { request: number; id?: string; pending: boolean }

export type WorkspaceTerminalsInput = {
  api: () => OpenCodeClient
  directory: string
  storage: PlatformStorage
  event: EventStream
  log?: (message: string, error: unknown) => void
}

export const TERMINAL_STORAGE_KEY = "workspace:terminal"

export function createWorkspaceTerminals(input: WorkspaceTerminalsInput) {
  const location = { directory: input.directory }
  const log = input.log ?? ((message, error) => console.error(message, error))
  const cell = createPersisted<TerminalState>({
    storage: input.storage,
    key: TERMINAL_STORAGE_KEY,
    decode: decodeTerminals,
    initial: EMPTY_TERMINALS,
  })
  const ready = createStore(false)
  void cell.ready.then(() => ready.set(() => true))
  const focus = createStore<FocusRequest | undefined>(undefined)
  const sequence = { request: 0 }
  const state = () => cell.store.get()
  const set = (update: (state: TerminalState) => TerminalState) => cell.set(update)

  const requestFocus = (id?: string, pending = false) => {
    sequence.request += 1
    focus.set(() => ({ request: sequence.request, id, pending }))
    return sequence.request
  }
  const cancelFocus = (request?: number) => {
    if (request !== undefined && focus.get()?.request !== request) return
    focus.set(() => undefined)
  }
  const focusRequested = (id?: string) => {
    const current = focus.get()
    if (!id || !current || current.pending) return false
    return !current.id || current.id === id
  }

  const update = (pty: Partial<LocalPTY> & { id: string }) => {
    const previous = state().all.find((item) => item.id === pty.id)
    set((current) => updateTerminal(current, pty))
    input
      .api()
      .pty.update({
        ptyID: pty.id,
        location,
        title: pty.title,
        size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
      })
      .catch((error: unknown) => {
        if (previous) set((current) => updateTerminal(current, previous))
        log("Failed to update terminal", error)
      })
  }

  const trim = (id: string) =>
    set((current) => {
      const pty = current.all.find((item) => item.id === id)
      if (!pty) return current
      const next = trimTerminal(pty)
      return next === pty ? current : updateTerminal(current, next)
    })

  const clone = async (id: string) => {
    const pty = state().all.find((item) => item.id === id)
    if (!pty) return
    const data = await input
      .api()
      .pty.create({ location, title: pty.title })
      .then((result) => result.data)
      .catch((error: unknown) => {
        log("Failed to clone terminal", error)
        return undefined
      })
    if (!data?.id) return
    set((current) => replaceTerminal(current, id, { id: data.id, title: data.title }))
  }

  const stopExited = input.event.on("pty.exited", (event) => set((current) => removeExited(current, event.data.id)))

  return {
    state: cell.store,
    ready,
    focus,
    create() {
      const number = nextTerminalNumber(state().all)
      const request = requestFocus(undefined, true)
      input
        .api()
        .pty.create({ location, title: defaultTitle(number) })
        .then((result) => {
          const id = result.data?.id
          if (!id) return cancelFocus(request)
          set((current) => addTerminal(current, { id, title: result.data.title ?? defaultTitle(number), titleNumber: number }))
          if (focus.get()?.request === request) focus.set(() => ({ request, id, pending: false }))
        })
        .catch((error: unknown) => {
          cancelFocus(request)
          log("Failed to create terminal", error)
        })
    },
    async close(id: string) {
      set((current) => closeTerminal(current, id))
      await input
        .api()
        .pty.remove({ ptyID: id, location })
        .catch((error: unknown) => log("Failed to close terminal", error))
    },
    update,
    trim,
    trimAll: () =>
      set((current) => {
        const all = current.all.map(trimTerminal)
        return all.every((pty, index) => pty === current.all[index]) ? current : { ...current, all }
      }),
    clone,
    open: (id: string) => set((current) => (current.active === id ? current : { ...current, active: id })),
    move: (id: string, to: number) => set((current) => moveTerminal(current, id, to)),
    next: () => set((current) => cycleTerminal(current, 1)),
    previous: () => set((current) => cycleTerminal(current, -1)),
    clear: () => set(() => EMPTY_TERMINALS),
    requestFocus: (id?: string) => void requestFocus(id),
    focusRequested,
    consumeFocus: (id: string) => {
      if (focusRequested(id)) focus.set(() => undefined)
    },
    cancelFocus: () => cancelFocus(),
    dispose: stopExited,
  }
}

export type WorkspaceTerminals = ReturnType<typeof createWorkspaceTerminals>
