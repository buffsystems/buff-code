# Buff e2e baseline (#561 / #584)

The app's Playwright suite is the acceptance contract for the React window. This file records
the Solid window's baseline and the React window's state when the baseline was taken
(2026-10-17, branch `feature/561-bc-baseline`).

## Command

```sh
cd packages/app
PLAYWRIGHT_PORT=<port> bunx playwright test                                  # Solid window
PLAYWRIGHT_APP_DIR=../app-react PLAYWRIGHT_PORT=<port> bunx playwright test  # React window
```

Dev mode (no `PLAYWRIGHT_BUILD`), `performance/**` and `service-worker/**` excluded by the config
(set `OPENCODE_PERFORMANCE=1` for the benches). 92 spec files, 468 tests.

## Result

- **Solid: 468 / 468 pass.** One full run with 3 workers: 462 passed; the 6 failures were the
  window not mounting within `APP_READY_TIMEOUT` while the shared host ran at load 15–30 (other
  agents' suites), and all 6 passed when re-run. If a spec fails only on «app visible» /
  «heading visible» under heavy load, re-run it before treating it as a regression.
- **React: 1 / 468 pass** (`regression/session-list-path-loading.spec.ts`); the React window has
  the core layer and Home so far.

## What the harness does

- `e2e/utils/storage-state.ts` (wired as `use.storageState` in `playwright.config.ts`): every
  context starts in English (`opencode.global.dat:language` = `{"locale":"en"}`) with titlebar
  tabs (`settings.v3` = `{"appearance":{"tabLayout":"horizontal"}}`) — upstream's defaults, which
  Buff changed (#471 Russian, #470 vertical column). Both windows read these keys before their
  first render. A spec that stores its own value overrides it; a fixture that writes
  `settings.v3` must merge into what is stored, not replace it.
- `e2e/utils/mock-buff.ts`: the mock server answers Buff's RPCs (`/api/rpc/buff.*`) like a
  freshly signed-in install — the `buff` credential in the integration list, organization `e2e`
  as context, a funded balance, no marks/skills/hooks/MCP servers, a clean checkout — and fails
  an unknown method as the real server does (400 `RpcError`). A spec that routes `/api/**`
  itself uses `buffRpcReply`.
- `e2e/utils/mock-server.ts`: a model without a stated price is a paid one (Buff sends only with
  a paid model, #457); the session diff endpoint is served.
- Specs that assert something Buff deliberately changed (cabinet look, Geist, About page, pasted
  text chips, rewind preview, MCP status words, no RTL/German locales, export switched off, …) are
  adapted with a `Buff (#…)` comment saying why.

## Known difference: dev vs built window

`vite.buff-text-scale.js` and `vite.buff-font-weight.js` rewrite CSS only in `generateBundle`, so
the dev window (what this suite and the React runs use) keeps upstream's 13px / 530 text while the
built window (`PLAYWRIGHT_BUILD=1`, CI) gets the scaled sizes and cabinet weights. A built run
fails the CSS assertions that were adapted to dev values (e.g. `session-summary-refresh`,
`session-timeline-lifecycle-state`, tab widths). The baseline above is the dev run.

## Per spec

| Spec | Tests | Solid | React |
| --- | ---: | --- | --- |
| `regression/background-read-failure.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/browser-polyfills.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/command-palette.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/command-registration.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/composer-command-draft.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/composer-large-paste.spec.ts` | 12 | Solid: pass | React: fail (0/12) |
| `regression/cross-server-tab-close.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/file-browser-sidebar-tab-switch.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/home-session-actions.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/inactive-tab-prefetch.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/mcp-workspace-toggle.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/mobile-files.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/mobile-review-open-file.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/mobile-review-summary.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/mobile-session-views.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/mobile-shell.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/mobile-summary-drawer.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/mobile-tab-interactions.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/mobile-timeline-scroll.spec.ts` | 56 | Solid: pass | React: fail (0/56) |
| `regression/new-session-dropzone.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/new-session-panel-corner.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/new-session-summary.spec.ts` | 9 | Solid: pass | React: fail (0/9) |
| `regression/new-session-workspace-branch.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/new-session-workspace-pending.spec.ts` | 13 | Solid: pass | React: fail (0/13) |
| `regression/open-file-expand-folder.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/patch-border.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/patch-sticky-header.spec.ts` | 32 | Solid: pass | React: fail (0/32) |
| `regression/project-autosave.spec.ts` | 3 | Solid: pass | React: fail (0/3) |
| `regression/project-lsp.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/prompt-thinking-level.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/remote-session-settings.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/remote-tab-busy.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/review-image-flash.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/review-line-comment.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/review-open-file.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/review-state-persistence.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/review-tab-switch.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/review-terminal-bottom.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/review-toggle-position.spec.ts` | 12 | Solid: pass | React: fail (0/12) |
| `regression/server-dialog-focus.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/session-header-controls.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-list-path-loading.spec.ts` | 1 | Solid: pass | React: pass |
| `regression/session-location-sync.spec.ts` | 7 | Solid: pass | React: fail (0/7) |
| `regression/session-message-revert.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-notice-truncation.spec.ts` | 6 | Solid: pass | React: fail (0/6) |
| `regression/session-panel-scrollbar.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-project-menu.spec.ts` | 7 | Solid: pass | React: fail (0/7) |
| `regression/session-prompt-spacing.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/session-queue.spec.ts` | 5 | Solid: pass | React: fail (0/5) |
| `regression/session-rename.spec.ts` | 8 | Solid: pass | React: fail (0/8) |
| `regression/session-request-docks.spec.ts` | 3 | Solid: pass | React: fail (0/3) |
| `regression/session-shell-completion.spec.ts` | 7 | Solid: pass | React: fail (0/7) |
| `regression/session-summary-config.spec.ts` | 5 | Solid: pass | React: fail (0/5) |
| `regression/session-summary-layout.spec.ts` | 6 | Solid: pass | React: fail (0/6) |
| `regression/session-summary-mcp.spec.ts` | 3 | Solid: pass | React: fail (0/3) |
| `regression/session-summary-refresh.spec.ts` | 9 | Solid: pass | React: fail (0/9) |
| `regression/session-summary.spec.ts` | 7 | Solid: pass | React: fail (0/7) |
| `regression/session-timeline-accessibility.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/session-timeline-cache.spec.ts` | 7 | Solid: pass | React: fail (0/7) |
| `regression/session-timeline-collapse-state.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/session-timeline-context-resize.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-timeline-context-state.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/session-timeline-file-projection.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-timeline-history-root.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-timeline-hydration.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-timeline-lifecycle-state.spec.ts` | 10 | Solid: pass | React: fail (0/10) |
| `regression/session-timeline-locale-projection.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/session-timeline-mount.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/session-timeline-notices.spec.ts` | 10 | Solid: pass | React: fail (0/10) |
| `regression/session-timeline-projection.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/session-timeline-reasoning-projection.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/session-timeline-reducer-projection.spec.ts` | 5 | Solid: pass | React: fail (0/5) |
| `regression/session-timeline-shell-outline.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/session-timeline-tool-projection.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/session-timeline-transport.spec.ts` | 8 | Solid: pass | React: fail (0/8) |
| `regression/session-timeline-working.spec.ts` | 14 | Solid: pass | React: fail (0/14) |
| `regression/session-workspace-tab-cycle.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/settings-loading.spec.ts` | 13 | Solid: pass | React: fail (0/13) |
| `regression/settings-padding.spec.ts` | 5 | Solid: pass | React: fail (0/5) |
| `regression/settings-project-edges.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
| `regression/settings-scroll.spec.ts` | 4 | Solid: pass | React: fail (0/4) |
| `regression/settings-search.spec.ts` | 14 | Solid: pass | React: fail (0/14) |
| `regression/settings-wsl.spec.ts` | 3 | Solid: pass | React: fail (0/3) |
| `regression/subagent-child-navigation.spec.ts` | 6 | Solid: pass | React: fail (0/6) |
| `regression/tab-navigate-mousedown.spec.ts` | 14 | Solid: pass | React: fail (0/14) |
| `regression/terminal-composer-focus.spec.ts` | 7 | Solid: pass | React: fail (0/7) |
| `regression/terminal-hidden.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/terminal-tab-switch.spec.ts` | 1 | Solid: pass | React: fail (0/1) |
| `regression/workspace-accent.spec.ts` | 24 | Solid: pass | React: fail (0/24) |
| `regression/workspaces-prefetch.spec.ts` | 6 | Solid: pass | React: fail (0/6) |
| `smoke/session-timeline.spec.ts` | 5 | Solid: pass | React: fail (0/5) |
| `user-story/model-selection-flow.spec.ts` | 2 | Solid: pass | React: fail (0/2) |
