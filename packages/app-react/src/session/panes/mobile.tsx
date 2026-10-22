// The side panes on a phone (#584): the «Changes», «Files» and «Usage» views of the session's
// «Session view» switcher — the Solid SessionMobileReview, SessionMobileFiles and context tab. A
// changed file opens in Files; the open file tabs are the side panel's own.

import { SESSION_OPEN_FILE_TAB } from "@opencode/app/react-reuse/session-tabs"
import { getDirectory, getFilename } from "@opencode/util/path"
import { Button, IconButton } from "@buff/ui/react"
import { ChevronDown, ChevronsUpDown, X } from "lucide-react"
import { useState } from "react"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { useSettings } from "../../shell/settings-context"
import { useMobileView } from "../mobile"
import { ContextTab } from "./context-tab"
import { useSideController } from "./controller"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { FileBrowser } from "./files/browser"
import type { Kind } from "./files/tree"
import { FileView } from "./files/view"
import { ReviewFilePreview } from "./review/file-preview"
import { ReviewModeMenu } from "./review/mode-menu"
import { reviewEmptyState, useReviewModel } from "./review/model"
import { usePaneSession } from "./session"

const NO_KINDS: ReadonlyMap<string, Kind> = new Map()
const NO_FILES: string[] = []

export function MobileChanges() {
  const i18n = useI18n()
  const side = useSideController()
  const mobile = useMobileView()
  const review = useReviewModel(side.session, true)
  const window = side.session.window
  const panel = useStore(window.layout.panel, (value) => value)
  const wrap = useSettings((settings) => settings.general.mobileDiffWrap)
  // The open files are the session view's, as the Solid review keeps them: they stay open across
  // the settings screen and the view switcher.
  const sessionKey = side.session.sessionKey
  const open = useStore(window.layout.layout, (value) =>
    sessionKey ? (value.sessionView?.[sessionKey]?.reviewOpen ?? NO_FILES) : NO_FILES,
  )
  const setOpen = (paths: string[]) => sessionKey && window.layout.review(sessionKey).setOpen(paths)
  const toggle = (file: string) =>
    setOpen(open.includes(file) ? open.filter((item) => item !== file) : [...open, file])
  const toggleAll = () => setOpen(open.length > 0 ? [] : review.diffs.map((diff) => diff.file))
  const openFile = (file: string) => {
    side.openFile(file)
    mobile?.select("files")
  }
  const empty = reviewEmptyState({ mode: review.mode, ready: review.ready, noGit: review.noGit })

  // The Solid SessionMobileReview: the changes' total and «Expand all» over a flush accordion;
  // an open file shows its change summary («Added», the counts, «Open file») above its diff.
  return (
    <div data-component="session-review" className="session-mobile-review">
      {/* The header is there with no changes too (the Solid review's title row), the review's mode
          at its start. */}
      <div data-slot="session-review-header" className="session-mobile-review__header">
        {review.options.length > 0 && (
          <div data-slot="session-review-title">
            <ReviewModeMenu options={review.options} mode={review.mode} onSelect={review.setMode} />
          </div>
        )}
        {review.diffs.length > 0 && (
          <>
            <DiffChanges changes={review.diffs} />
            <div data-slot="session-review-actions" className="session-mobile-review__actions">
              <Button size="sm" variant="ghost" onClick={toggleAll}>
                <ChevronsUpDown aria-hidden />
                {i18n.t(open.length > 0 ? "ui.sessionReview.collapseAll" : "ui.sessionReview.expandAll")}
              </Button>
            </div>
          </>
        )}
      </div>
      <div data-slot="session-review-list" className="session-mobile-review__list">
        {review.diffs.length === 0 && (
          <p className="ui-note px-3 py-2">
            {empty === "loading"
              ? `${i18n.t("common.loading")}${i18n.t("common.loading.ellipsis")}`
              : i18n.t("session.review.noUncommittedChanges")}
          </p>
        )}
        {review.diffs.map((diff) => {
          const expanded = open.includes(diff.file)
          return (
            <section
              key={diff.file}
              data-slot="accordion-item"
              data-file={diff.file}
              data-expanded={expanded || undefined}
              className="session-mobile-review__item"
            >
              <h3 data-slot="accordion-header" className="session-mobile-review__header-row">
                <button
                  type="button"
                  data-slot="accordion-trigger"
                  aria-expanded={expanded}
                  aria-label={diff.file}
                  className="session-mobile-review__trigger"
                  onClick={() => toggle(diff.file)}
                >
                  <FileIcon path={diff.file} />
                  <span className="session-mobile-review__file">
                    {diff.file.includes("/") && (
                      <span data-slot="session-review-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
                    )}
                    <span data-slot="session-review-filename">{getFilename(diff.file)}</span>
                  </span>
                  <ChevronDown aria-hidden className="session-mobile-review__chevron" />
                </button>
              </h3>
              {expanded && (
                <div data-slot="session-review-change-summary" className="session-mobile-review__summary">
                  <ChangeStatus status={diff.status} />
                  <DiffChanges changes={[diff]} />
                  <Button
                    data-slot="session-review-summary-open-file"
                    size="sm"
                    variant="ghost"
                    className="session-mobile-review__open"
                    onClick={() => openFile(diff.file)}
                  >
                    {i18n.t("ui.sessionReview.openFile")}
                  </Button>
                </div>
              )}
              {expanded && (
                <div data-slot="accordion-content" className="session-mobile-review__content">
                  <ReviewFilePreview
                    file={diff.file}
                    diff={diff}
                    diffStyle="unified"
                    expandMode={panel.expandMode}
                    comments={review.comments}
                    overflow={wrap ? "wrap" : "scroll"}
                    bare
                  />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** «Added» or «Removed» before an open file's counts; a modified file shows only its counts. */
function ChangeStatus(props: { status?: string }) {
  const i18n = useI18n()
  if (props.status === "added")
    return (
      <span data-slot="session-review-change" data-type="added">
        {i18n.t("ui.sessionReview.change.added")}
      </span>
    )
  if (props.status === "deleted")
    return (
      <span data-slot="session-review-change" data-type="removed">
        {i18n.t("ui.sessionReview.change.removed")}
      </span>
    )
  return null
}

export function MobileFiles() {
  const i18n = useI18n()
  const side = useSideController()
  const { files, sessionKey, window } = side.session
  const tabs = side.derived.openedTabs.filter((tab) => !!side.pathFromTab(tab))
  const active = side.derived.activeFileTab
  const [browsing, setBrowsing] = useState(!active)
  const showBrowser = browsing || !active
  const open = (path: string) => {
    if (!files) return
    side.openTab(files.tab(path))
    setBrowsing(false)
  }
  if (!files || !sessionKey) return null

  return (
    <div data-slot="session-mobile-files" data-browsing={showBrowser} className="session-mobile-files">
      <div data-slot="session-mobile-files-header" className="session-mobile-files__header">
        <Button size="sm" variant="ghost" aria-pressed={showBrowser} onClick={() => setBrowsing(true)}>
          {i18n.t("session.files.all")}
        </Button>
        <div role="tablist" aria-label={i18n.t("session.files.openTabs")} className="session-mobile-files__tabs">
          {tabs.map((tab) => {
            const path = side.pathFromTab(tab) ?? tab
            const selected = !showBrowser && tab === active
            return (
              <div
                key={tab}
                data-slot="tabs-v2-trigger-wrapper"
                data-selected={selected || undefined}
                className="session-mobile-files__tab"
              >
                <button type="button" role="tab" aria-selected={selected} onClick={() => open(path)}>
                  <span dir="ltr" className="truncate">
                    {getFilename(path)}
                  </span>
                </button>
                <IconButton icon={X} size="xs" aria-label={i18n.t("common.closeTab")} onClick={() => side.close(tab)} />
              </div>
            )
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {showBrowser ? (
          <FileBrowser
            server={side.session.server}
            files={files}
            layout={window.layout}
            sessionKey={sessionKey}
            title={side.session.project?.name ?? ""}
            tab={active ?? SESSION_OPEN_FILE_TAB}
            placeholder
            kinds={NO_KINDS}
            onSelect={open}
            onSelectPermanent={open}
          />
        ) : (
          active && <FileView files={files} tab={active} sessionKey={sessionKey} />
        )}
      </div>
    </div>
  )
}

export function MobileUsage() {
  return <ContextTab session={usePaneSession()} />
}
