# The draft screen — slots and the send contract (#584)

`/new-session?draftId=…` renders **the draft screen** (owned by the shell agent:
`src/new-session/**`). A draft is a tab of the shell's tab store (`src/shell/tabs/tabs.ts`,
`DraftTab { draftID, server, directory, worktree?, branch?, mcp? }`). The screen draws the frame —
the wordmark, the project and workspace pickers, the «Session details» summary — and fills
**named slots** with what other features contribute. A feature plugs in by **adding a file**,
never by editing the screen.

## How a feature plugs in

Create `src/<your-folder>/draft-slot.tsx` whose default export is one `DraftSlot` or an array:

```tsx
// src/composer/draft-slot.tsx
import { lazy } from "react"
import type { DraftSlot } from "../new-session/slots"

export default {
  slot: "composer",
  id: "composer",
  component: lazy(() => import("./draft-composer").then((module) => ({ default: module.DraftComposer }))),
} satisfies DraftSlot
```

The screen collects every `src/*/draft-slot.tsx` with `import.meta.glob` (eager — keep the file
tiny, lazy-load the component). Entries of one slot render by ascending `order` (default 0), then
`id`; each has its own error boundary and `Suspense`.

| slot              | where                                                                         | who        |
| ----------------- | ----------------------------------------------------------------------------- | ---------- |
| `composer`        | the prompt box under the wordmark                                             | composer   |
| `above-composer`  | strips right above the composer (Buff: no model, snapshot git)                | composer   |
| `surface`         | over the whole draft surface (the file dropzone)                              | composer   |
| `project-bar`     | chips in the row under the composer, beside the project and workspace pickers | any        |
| `project-bar-end` | the end of that row, after the workspace picker (Buff: the balance)           | any        |
| `summary`         | inside «Session details», under the project card (MCP, plugins, skills, LSP)  | side panes |

A slot component takes **no props**; it reads `useDraft()` (`src/new-session/context.tsx`).

## `useDraft()`

```ts
{
  draft: DraftTab                 // the tab; changes when the person picks another project
  server: Server                  // the draft's server controller (server.data, server.api())
  directory: string               // the chosen project's directory (draft.directory)
  workspace: {
    value: string                 // "main" (the project itself), "create" (a new worktree) or a worktree directory
    branch?: string               // the base branch a new worktree starts from, or the selected worktree's branch
    git: boolean                  // the project is a Git repository (workspaces are offered)
    target: string                // the directory a session would run in now ("create" → the project directory)
  }
  mcp: {
    states: Record<string, boolean>   // the MCP servers the person switched for this draft
    preview: boolean                  // true while "create": switches are only recorded, applied after the worktree exists
    pending: boolean
    change(name: string, enabled: boolean): void
  }
  /** Start the session; see below. Resolves undefined when it did not start (a toast said why). */
  start(input: DraftStartInput): Promise<DraftStarted | undefined>
  /** Put the caret back in the composer (the composer registers its focus here). */
  focus: { register(focus: () => void): () => void; restore(): void }
}
```

### Sending the first prompt — `start`

The composer owns the prompt, the model and the message; the draft owns **where** and **when**
the session exists. `start` does, in order (a port of the Solid `composer-adapter.ts`):

1. With **a new worktree** selected, the draft tab turns into a _pending_ session tab right away
   (`tabs.prepareSession`, the window shows the session route with `input.message` as its first
   message) while the worktree is created; any failure rolls the tab back to the draft, keeping
   the new worktree selected only if it was created.
2. Resolves the directory: the project (`main`), a created worktree (`create`, from
   `workspace.branch`), or the chosen worktree.
3. Applies the draft's MCP switches in that directory; failing that, rolls back (toast).
4. Calls **`input.create(directory)`** — the composer creates the session there (its
   `data.session.create(...)` with `input.sessionID`, agent, model, permissions) and resolves
   when the server confirmed it. A rejection rolls back and shows Buff's «the message is still in
   the input box» toast (`sessionCreateFailure`).
5. Promotes the draft tab to the session tab in place (or, after a pending start, leaves the
   pending tab for `complete`), remembers local vs worktree as the project's last choice.

```ts
type DraftStartInput = {
  sessionID: string // the id the composer will create the session with
  message?: SessionMessageUser // shown in the pending tab while a worktree is created
  create: (directory: string) => Promise<void>
}
type DraftStarted = {
  sessionID: string
  directory: string
  /** After a pending start: call once the composer moved its state to the session; ends pending. */
  complete?: () => Promise<void>
}
```

After `start` resolves the composer sends the prompt to the session (and retargets its own draft
state). The draft never sends prompts itself.

## The DOM the screen keeps

`[data-component="new-session"]` (the surface, `data-summary-open`), `[data-slot="new-session-summary"]`
with the «Session details» button, `[data-slot="new-session-content"]`, the project picker and
the workspace picker (`Local` / `New worktree` / a worktree, «from <branch>», «Search branches»).
