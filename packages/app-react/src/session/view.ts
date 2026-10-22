// The session tab's view state (#584): whether the review and the terminal are shown, the terminal's
// height and the chat panel's width — each tab's panes, stored by the shell's tab store under the
// Solid window's `tabs.panes` (see shell/tabs/tabs.ts), so a tab comes back as it was left.

import { SESSION_PANEL_WIDTH_MIN } from "@opencode/app/react-reuse/session-panel-width"
import type { Store } from "../core/store"

export type SessionPanes = { review?: boolean; terminal?: boolean; terminalHeight?: number; sessionWidth?: number }

/** Where the panes are kept: every tab's, by tab key, and a way to change one. */
export type PaneStore = {
  store: Store<Record<string, SessionPanes>>
  set: (key: string, patch: SessionPanes) => void
}

export type SessionView = { review: boolean; terminal: boolean; terminalHeight: number; sessionWidth: number }

export const DEFAULT_TERMINAL_HEIGHT = 280
export const DEFAULT_SESSION_WIDTH = 600
export const TERMINAL_HEIGHT_MIN = 100

export const DEFAULT_SESSION_VIEW: SessionView = {
  review: false,
  terminal: false,
  terminalHeight: DEFAULT_TERMINAL_HEIGHT,
  sessionWidth: DEFAULT_SESSION_WIDTH,
}

export function readSessionView(panes: SessionPanes | undefined): SessionView {
  if (!panes) return DEFAULT_SESSION_VIEW
  return {
    review: panes.review ?? false,
    terminal: panes.terminal ?? false,
    terminalHeight: panes.terminalHeight ?? DEFAULT_TERMINAL_HEIGHT,
    sessionWidth: panes.sessionWidth ?? DEFAULT_SESSION_WIDTH,
  }
}

/** A tab's view over the pane store; without a tab (not opened yet) it reads the defaults and keeps nothing. */
export function createSessionViews(panes: PaneStore) {
  const read = (key: string | undefined) => readSessionView(key === undefined ? undefined : panes.store.get()[key])
  return {
    store: panes.store,
    read,
    actions(key: string | undefined) {
      const set = (patch: SessionPanes) => key !== undefined && panes.set(key, patch)
      return {
        openReview: () => set({ review: true }),
        closeReview: () => set({ review: false }),
        toggleReview: () => set({ review: !read(key).review }),
        openTerminal: () => set({ terminal: true }),
        closeTerminal: () => set({ terminal: false }),
        toggleTerminal: () => set({ terminal: !read(key).terminal }),
        /** The stored state now: the rendered view lags behind it (it updates as a transition). */
        terminalOpen: () => read(key).terminal,
        resizeTerminal: (height: number) => set({ terminalHeight: Math.max(TERMINAL_HEIGHT_MIN, Math.round(height)) }),
        resizeSession: (width: number) => set({ sessionWidth: Math.max(SESSION_PANEL_WIDTH_MIN, Math.round(width)) }),
      }
    },
  }
}

export type SessionViews = ReturnType<typeof createSessionViews>
export type SessionViewActions = ReturnType<SessionViews["actions"]>
