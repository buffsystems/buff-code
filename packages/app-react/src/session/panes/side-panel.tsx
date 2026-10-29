// The side panel (#584): Review, Context and the file tabs over their panels — the Solid
// SessionSidePanel on desktop. The tab bar carries the review sidebar's toggle, the tabs (sorted by
// dragging, closed by their button or a middle click) and the "Open file" button.

import { SESSION_OPEN_FILE_TAB, isSessionBrowserTab, sideSessionOf } from "@opencode/app/react-reuse/session-tabs"
import { createFileTabListSync } from "@opencode/app/react-reuse/file-tab-scroll"
import { reviewDiffKinds } from "@opencode/app/react-reuse/review-diff-kinds"
import { getFilename } from "@opencode/util/path"
import { IconButton, Kbd, Tooltip } from "@buff/ui/react"
import { FolderTree, Plus } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { formatKeybindParts, type KeyLabel } from "../../commands/keybind"
import { useCommands } from "../../commands/provider"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { filterFocus, useSideController, type SideController } from "./controller"
import { AddTabMenu, BrowserTabPanel, BrowserTabTrigger, browserTabOf } from "./browser/side"
import { ContextTab } from "./context-tab"
import { FileIcon } from "./file-icon"
import { FileBrowser } from "./files/browser"
import { FileRowMenu, type Kind } from "./files/tree"
import { diffStyleOf } from "./layout"
import { ReviewModeMenu } from "./review/mode-menu"
import { ReviewPanel, ReviewSidebarToggle } from "./review/panel"
import { useReviewModel, reviewEmptyState, type ReviewModel } from "./review/model"
import { fileBrowserVisible, fileTreeToggles } from "./side-tabs"
import { SideConversationPanel, SideConversationTabTrigger } from "./side-conversation-tab"
import { PaneTab, PaneTabList, SortablePaneTab } from "./tabs"
import { ReviewSurface } from "../regions"
import { useCore } from "../../react/core"
import { draftRegistry } from "../composer/draft/registry"
import { showToast } from "../../shell/notifications/toast"
import { OpenInAppButton, OpenInAppMenuItems, useOpenInApp, type OpenInApp } from "./open-in-app"
import { resolveOpenInAppPath } from "@opencode/app/react-reuse/open-in-app-path"
import "./panes.css"

const REVIEW_TAB_ID = "session-side-panel-review-tab"
const REVIEW_PANEL_ID = "session-side-panel-review-tabpanel"
const FILE_BROWSER_PANEL_ID = "session-side-panel-file-browser-tabpanel"

export function SidePanel() {
  const i18n = useI18n()
  return (
    <ReviewSurface label={i18n.t("session.panel.reviewAndFiles")}>
      <SidePanelContent />
    </ReviewSurface>
  )
}

// Apart from the surface: the surface follows the frame at once, the contents render after it.
const SidePanelContent = memo(function SidePanelContent() {
  const side = useSideController()
  const { session, derived } = side
  const active = derived.activeTab
  const review = useReviewModel(session, side.view.review && (active === "review" || !!derived.activeFileTab))
  const title = session.project?.name || getFilename(session.directory ?? "") || (session.directory ?? "")
  const openIn = useOpenInApp({ conn: session.server.conn, directory: session.directory })
  const rowMenu = useFileRowMenu(openIn, session)

  return (
    <div className="flex size-full min-w-0 flex-col">
      <TabBar side={side} review={review} openIn={openIn} />
      <FileRowMenu value={rowMenu}>
        <Panels side={side} review={review} title={title} />
      </FileRowMenu>
    </div>
  )
})

/** The trees' file menu: «Open in», copy the path and add the file to the chat (desktop, own server). */
function useFileRowMenu(openIn: OpenInApp, session: SideController["session"]) {
  const i18n = useI18n()
  const core = useCore()
  const directory = session.directory
  if (!openIn.canOpen || !directory) return undefined
  // As in the Solid window: a mention at the end of the composer's text, which the person sees and sends.
  const addToChat = (path: string) => {
    const host = { storage: core.platform.storage, draftStore: core.platform.draftStore }
    const draft = draftRegistry(host).get({
      type: "session",
      scope: core.scope(session.server.key),
      directory,
      sessionID: session.sessionID,
    })
    draft.appendMention({ type: "file", path, content: `@${path}`, start: 0, end: 0 })
    showToast({ title: i18n.buff.t("Added to chat"), description: `@${path}` })
  }
  return (path: string) => (
    <OpenInAppMenuItems
      state={openIn}
      path={resolveOpenInAppPath(directory, path)}
      onAddToChat={() => addToChat(path)}
    />
  )
}

function CloseHint() {
  const i18n = useI18n()
  const commands = useCommands()
  const keybind = commands.keybind("file.close")
  return (
    <span className="flex items-center gap-2">
      {i18n.t("common.closeTab")}
      {keybind && formatKeybindParts(keybind, (key: KeyLabel) => i18n.t(key)).map((part) => <Kbd key={part}>{part}</Kbd>)}
    </span>
  )
}

function TabBar(props: { side: SideController; review: ReviewModel; openIn: OpenInApp }) {
  const i18n = useI18n()
  const commands = useCommands()
  const { side, review } = props
  const { derived } = side
  const active = derived.activeTab
  const list = useRef<HTMLDivElement>(null)
  const contextOpen = useRef(derived.contextOpen)
  contextOpen.current = derived.contextOpen
  useEffect(() => {
    const element = list.current
    if (!element) return
    return createFileTabListSync({ el: element, contextOpen: () => contextOpen.current })
  }, [])
  const files = side.session.files
  const openKeybind = commands.keybind("file.open")
  const all = side.stored.all
  const openLabel = i18n.t("command.file.open")

  return (
    <div className="session-review-v2-tabs-bar sticky top-0 flex shrink-0 items-center">
      <PaneTabList listRef={list} className="panes-tablist" onMove={side.move}>
        <div className="session-review-v2-sidebar-toggle-slot sticky start-0 z-10 flex h-full shrink-0 items-center justify-center">
          {/* Buff (#705): only where a tree is; the slot keeps its room so the tabs do not shift. */}
          {side.session.window && (
            <div className={fileTreeToggles(active) ? "contents" : "invisible"} inert={!fileTreeToggles(active)}>
              <ReviewSidebarToggle layout={side.session.window.layout} disabled={!fileTreeToggles(active)} />
            </div>
          )}
        </div>
        <PaneTab
          value="review"
          id={REVIEW_TAB_ID}
          selected={active === "review"}
          ariaControls={active === "review" ? REVIEW_PANEL_ID : undefined}
          onSelect={() => side.activate("review")}
        >
          {review.hasChanges
            ? i18n.t("session.review.filesChanged", { count: review.count })
            : i18n.t("session.tab.review")}
        </PaneTab>
        {derived.contextOpen && (
          <PaneTab
            value="context"
            selected={active === "context"}
            onSelect={() => side.activate("context")}
            onClose={() => side.close("context")}
            closeHint={<CloseHint />}
          >
            {i18n.t("session.tab.context")}
          </PaneTab>
        )}
        {derived.panelTabs.map((tab) => {
          if (isSessionBrowserTab(tab)) {
            const item = browserTabOf(side.browser, tab)
            if (!item) return null
            return (
              <BrowserTabTrigger
                key={tab}
                browser={side.browser}
                tab={item}
                index={all.indexOf(tab)}
                selected={active === tab}
                onSelect={() => side.activate(tab)}
                closeHint={<CloseHint />}
              />
            )
          }
          const sideSession = sideSessionOf(tab)
          if (sideSession)
            return (
              <SideConversationTabTrigger
                key={tab}
                side={side}
                tab={tab}
                session={sideSession}
                closeHint={<CloseHint />}
              />
            )
          if (tab === SESSION_OPEN_FILE_TAB)
            return (
              <PaneTab
                key={tab}
                value={tab}
                selected={active === tab}
                className="group"
                onSelect={() => side.activate(tab)}
                onClose={() => side.close(tab)}
                closeHint={<CloseHint />}
              >
                <span className="flex items-center gap-1.5">
                  <FolderTree aria-hidden className="size-4" />
                  <span>{openLabel}</span>
                </span>
              </PaneTab>
            )
          const path = side.pathFromTab(tab)
          const state = path && files ? files.get(path) : undefined
          const notFound = !!state?.notFound
          const temporary = side.preview === tab
          return (
            <SortablePaneTab
              key={tab}
              value={tab}
              index={all.indexOf(tab)}
              selected={active === tab}
              ariaLabel={notFound && path ? i18n.t("file.error.notFound", { name: getFilename(path) }) : undefined}
              onSelect={() => side.activate(tab)}
              onClose={() => side.close(tab)}
              onDoubleClick={temporary ? () => side.openTab(tab) : undefined}
              closeHint={<CloseHint />}
            >
              {path && (
                <span className="flex min-w-0 items-center gap-x-1.5">
                  <FileIcon path={path} />
                  <span
                    className="panes-tab-name truncate"
                    data-temporary={temporary ? "" : undefined}
                    data-file-not-found={notFound ? "" : undefined}
                  >
                    {getFilename(path)}
                  </span>
                </span>
              )}
            </SortablePaneTab>
          )
        })}
        <div className="sticky end-0 z-10 flex h-full shrink-0 items-center justify-center">
          {side.browser.available ? (
            <AddTabMenu browser={side.browser} onOpenFile={side.openFileBrowser} />
          ) : (
          <Tooltip
            side="bottom"
            content={
              <span className="flex items-center gap-2">
                {openLabel}
                {openKeybind &&
                  formatKeybindParts(openKeybind, (key: KeyLabel) => i18n.t(key)).map((part) => <Kbd key={part}>{part}</Kbd>)}
              </span>
            }
          >
            <IconButton icon={Plus} size="md" aria-label={openLabel} onClick={side.openFileBrowser} />
          </Tooltip>
          )}
        </div>
      </PaneTabList>
      <div
        data-slot="session-side-panel-actions"
        className="session-review-v2-open-in-app-slot flex shrink-0 items-center gap-2 self-start pe-3"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {props.openIn.canOpen && props.side.session.directory && <OpenInAppButton state={props.openIn} />}
        <div className="size-7 shrink-0" aria-hidden />
      </div>
    </div>
  )
}

/**
 * The review body waits out the session's first frame, as the Solid review's `deferRender` /
 * `panelRendered`: opening a session paints the session before the review's diffs, and once
 * rendered the body stays.
 */
function useReviewBodyReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ready) return
    const timers: { timeout?: ReturnType<typeof setTimeout> } = {}
    const frame = requestAnimationFrame(() => {
      timers.timeout = setTimeout(() => setReady(true), 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timers.timeout)
    }
  }, [ready])
  return ready
}

function Panels(props: { side: SideController; review: ReviewModel; title: string }) {
  const i18n = useI18n()
  const reviewReady = useReviewBodyReady()
  const { side, review } = props
  const { derived, session } = side
  const active = derived.activeTab
  const files = session.files
  const window = session.window
  const diffStyle = useStore(window.layout.layout, diffStyleOf)
  const kinds = useMemo(() => reviewDiffKinds(review.diffs) as ReadonlyMap<string, Kind>, [review.diffs])
  const filter = useRef<HTMLInputElement>(null)
  const focusCount = useStore(filterFocus, (count) => count)
  useEffect(() => {
    if (focusCount === 0) return
    const frame = requestAnimationFrame(() => filter.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focusCount])

  const fileTab =
    active === SESSION_OPEN_FILE_TAB ? active : active && side.pathFromTab(active) ? active : derived.activeFileTab
  // The browser stays mounted while any file tab exists, so switching tabs keeps its tree and scroll.
  const browserMounted = derived.openedTabs.length > 0 || derived.openFileOpen || !!fileTab
  const browserVisible = fileBrowserVisible(active)
  const sideSession = sideSessionOf(active)
  const browserTab = fileTab ?? derived.activeFileTab ?? SESSION_OPEN_FILE_TAB
  const readFile = (path: string) =>
    files ? files.load(path).then(() => files.get(path)?.content) : Promise.resolve(undefined)

  const reviewEmpty = (() => {
    const state = reviewEmptyState({ mode: review.mode, ready: review.ready, noGit: review.noGit })
    if (state === "loading") return <div className="ui-note px-6 py-4">{i18n.t("session.review.loadingChanges")}</div>
    if (state === "no-git")
      return (
        <div className="flex h-full flex-col items-center justify-center pb-64 text-center">
          <div className="ui-note max-w-56">{i18n.t("session.review.noVcs")}</div>
        </div>
      )
    return (
      <div data-slot="session-review-v2-empty-changes">
        <div data-slot="session-review-v2-empty-changes-title">{i18n.t("ui.sessionReviewV2.empty.changes.title")}</div>
        <div data-slot="session-review-v2-empty-changes-description" className="ui-note">
          {i18n.t("ui.sessionReviewV2.empty.changes.description")}
        </div>
      </div>
    )
  })()

  const reviewTitle =
    review.options.length > 0 ? (
      <ReviewModeMenu options={review.options} mode={review.mode} onSelect={review.setMode} />
    ) : undefined

  return (
    <div className="relative min-h-0 flex-1">
      {active === "review" && (
        <div
          id={REVIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={REVIEW_TAB_ID}
          data-slot="tabs-content"
          className="flex h-full flex-col overflow-hidden"
        >
          {reviewReady && (
            <ReviewPanel
              layout={window.layout}
              files={files}
              title={reviewTitle}
              empty={reviewEmpty}
              diffs={review.diffs}
              diffsReady={review.ready}
              diffVersion={review.diffVersion}
              loadDiff={review.loadDiff}
              activeFile={review.activeFile}
              onSelectFile={review.focusFile}
              diffStyle={diffStyle}
              onDiffStyleChange={window.layout.setDiffStyle}
              readFile={readFile}
              comments={review.comments}
              mention={files ? { items: files.searchFilesAndDirectories } : undefined}
            />
          )}
        </div>
      )}
      {active === "empty" && (
        <div role="tabpanel" data-slot="tabs-content" className="flex h-full flex-col items-center justify-center pb-42 text-center">
          <div className="ui-note max-w-56">{i18n.t("session.files.selectToOpen")}</div>
        </div>
      )}
      {active === "context" && (
        <div role="tabpanel" data-slot="tabs-content" className="flex h-full flex-col overflow-hidden">
          <ContextTab session={session} />
        </div>
      )}
      {sideSession && <SideConversationPanel side={side} session={sideSession} />}
      <BrowserTabPanel browser={side.browser} activeTab={active} panelOpen={side.view.review} />
      {browserMounted && files && session.sessionKey && (
        <div
          id={FILE_BROWSER_PANEL_ID}
          role="tabpanel"
          data-slot="tabs-content"
          className={browserVisible ? "h-full min-h-0 overflow-hidden" : "hidden"}
          inert={!browserVisible}
        >
          <FileBrowser
            server={session.server}
            files={files}
            layout={window.layout}
            sessionKey={session.sessionKey}
            title={props.title}
            tab={browserTab}
            placeholder={browserTab === SESSION_OPEN_FILE_TAB}
            active={files.pathFromTab(browserTab)}
            kinds={kinds}
            onSelect={(path) => side.previewTab(files.tab(path))}
            onSelectPermanent={(path) => side.openTab(files.tab(path))}
            filterRef={filter}
          />
        </div>
      )}
    </div>
  )
}
