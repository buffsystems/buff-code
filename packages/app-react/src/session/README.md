# The session screen — layout and slots (#584)

The route `/server/:serverKey/session/:id` renders **the session layout** (owned by the shell
agent: `src/session/layout.tsx`, `src/session/context.tsx`, `src/session/slots.ts`). The layout
draws the frame — the chat panel, the side region, the bottom region — and fills each **named
slot** with whatever the feature folders contribute. A feature plugs in by **adding a file**, never
by editing the layout, the route or `app.tsx`.

## How a feature plugs in

Create `src/session/<your-folder>/slot.tsx` whose default export is one `SessionSlot` or an array
of them (a region's pane — `side`, `bottom` — is imported directly, not lazily, so the region opens
and animates in the same commit as its contents):

```tsx
// src/session/timeline/slot.tsx
import { lazy } from "react"
import type { SessionSlot } from "../slots"

export default {
  slot: "timeline",
  id: "timeline",
  component: lazy(() => import("./timeline").then((module) => ({ default: module.Timeline }))),
} satisfies SessionSlot
```

The layout collects every `src/session/*/slot.tsx` with `import.meta.glob` (eager — keep
`slot.tsx` tiny and lazy-load the real component as above). Several entries in one slot render in
ascending `order` (default 0), then by `id`. Each slot is wrapped in its own error boundary and
`Suspense`, so one feature failing or loading never blanks the others.

## The slots

| slot             | where                                                                                                                                 | who        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `header`         | top of the chat panel, above the timeline (session title, actions)                                                                    | timeline   |
| `timeline`       | the chat panel's scrolling body (`flex-1 min-h-0`)                                                                                    | timeline   |
| `chat-overlay`   | absolutely positioned over the chat body (search bar, dropzone, map)                                                                  | any        |
| `composer`       | bottom of the chat panel, under the timeline                                                                                          | composer   |
| `panel-actions`  | top-end corner over the panels (the review toggle); mounted on phones too                                                             | side panes |
| `side`           | the side column's upper region (review, files, context…)                                                                              | side panes |
| `bottom`         | the terminal: under the review in the side column («beside», the default) or across the bottom (`settings.general.terminalPlacement`) | side panes |
| `mobile-changes` | a phone's «Changes» view                                                                                                              | side panes |
| `mobile-files`   | a phone's «Files» view                                                                                                                | side panes |
| `mobile-usage`   | a phone's «Usage» view (context usage)                                                                                                | side panes |

A slot component takes **no props**. Everything it needs comes from hooks:

- `useSession()` (`src/session/context.tsx`) — `{ conn, server, serverKey, sessionID }`: the
  routed server connection, its live `Server` controller (`server.data`, `server.api()`), and
  the session id. The layout has already started `server.data.session.sync(sessionID)`.
- `useSessionView()` — the session tab's view state: `{ review, terminal, terminalHeight,
sessionWidth }` (sessionWidth is the chat panel's width, as in Solid) with `openReview /
closeReview / toggleReview / openTerminal / closeTerminal / toggleTerminal / resizeTerminal /
resizeSession`. It is the tab's panes, kept by the shell's tab store under the Solid window's
  `opencode.window.<id>.dat:tabs.panes` (by tab key; a subagent shows in its root's tab), so each
  tab comes back as it was left. A change reaches the panes as a transition, after the frame has
  moved; the frame itself reads `useSessionViewNow()`.
- `useSessionRegions()` (`src/session/regions.tsx`) — how the layout shows the panes: `review`
  `{ opened, present, stacked, resizing }`, `terminal` `{ opened, present, stacked, fill, height,
contentHeight, animate, reserveReviewToggle, … }`. A region once shown stays mounted while
  hidden (`present`), so switching tabs never remounts the review or reconnects a terminal. The
  panes render inside `ReviewSurface` / `TerminalSurface`, which carry `#review-panel` /
  `#terminal-panel`, their aria and their size animation.
- `useMobileView()` (`src/session/mobile.tsx`) — on a phone, the shown view and `select(view)`
  (Session / Changes / Files / Terminal / Usage).
- The usual core hooks (`useServerData`, `useI18n`, `useCommandRegistration`, `useDialog`,
  `useNavigate`, …).

Slots of different features talk only through the core (`server.data`, a store in `core/`) or
through a module in their own folder that both sides import — never through the layout.

## The DOM the layout keeps

The e2e specs locate these, so the layout renders them exactly:

- `[data-slot="session-chat-panel"]` — the chat panel (header, timeline, overlay, composer), with
  `data-width-animating` and `data-scrollbar-hidden` while it slides.
- `[data-slot="session-side-panel-presence"]` > `[data-slot="session-side-panel-content"]` >
  `[data-slot="session-side-region"]` > `[data-slot="session-side-region-presence"]` (the review),
  then `[data-slot="session-side-panel-gap"]` and `[data-slot="session-side-terminal-region"]` >
  `[data-slot="side-terminal-panel-presence"]` (the terminal beside the review).
- `[data-slot="terminal-panel-presence"]` — the terminal across the bottom.
- `[data-slot="session-mobile-view-navigation"]` with the «Session view» tablist on a phone.

Everything inside a slot (`data-slot="session-timeline-scroll"`, `data-component="composer"`, …)
is the slot owner's to render.

## Testing a slot alone

`renderSessionSlot(<Component />, { sessionID, data })` in `src/session/test.tsx` mounts a
component inside the providers and a `SessionProvider` over a fake server, for `bun test`.
