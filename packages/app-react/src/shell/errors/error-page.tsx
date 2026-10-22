// The fatal error page (#584): what broke, the details to copy, and the way out — reload or
// restart, update if one waits. An error boundary shows it in place of the window.

import { Button, Field, Textarea } from "@buff/ui/react"
import { errorDescriptionKey, errorStatus } from "@opencode/app/react-reuse/error-description"
import { BuffLinks } from "@opencode/schema/buff-links"
import { Component, useEffect, useRef, useState, type ReactNode } from "react"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useUpdaterState } from "../updates/update-button"
import { formatError } from "./format"

export class ErrorBoundary extends Component<{ children?: ReactNode }, { error?: unknown; failed: boolean }> {
  state: { error?: unknown; failed: boolean } = { failed: false }
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <ErrorPage error={this.state.error} />
  }
}

export function ErrorPage(props: { error: unknown }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const updater = useUpdaterState()
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const details = formatError(props.error, i18n.t)
  const status = errorStatus(props.error)
  const version = updater?.status === "ready" || updater?.status === "download-required" ? updater.version : undefined
  const busy = ["checking", "downloading", "installing"].includes(updater?.status ?? "")
  const fail = (error: unknown) => setActionError(formatError(error, i18n.t))
  // The error goes into the app's log once, before any logs export that would carry it.
  const recorded = useRef<Promise<void> | undefined>(undefined)
  const record = () => {
    recorded.current ??=
      platform.recordFatalRendererError?.({
        error: details,
        url: location.href,
        version: platform.version,
        platform: platform.platform,
        os: platform.os,
      }) ?? Promise.resolve()
    return recorded.current
  }
  useEffect(() => {
    void record().catch(() => undefined)
  })
  const exportLogs = platform.platform === "desktop" ? platform.exportDebugLogs : undefined
  return (
    <div
      data-component="error-page"
      className="relative flex h-full min-h-0 w-full flex-1 flex-col items-center justify-start overflow-y-auto p-4 sm:justify-center sm:p-8"
    >
      <div className="my-auto flex w-full max-w-3xl flex-col items-center justify-center gap-6 sm:gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="ui-title ui-title--lg">{i18n.t(status ? "error.page.title.status" : "error.page.title")}</h1>
          <p className="ui-note">
            {status ? i18n.t("error.page.description.status", { status }) : i18n.t(errorDescriptionKey(props.error))}
          </p>
        </div>
        <Field label={i18n.t("error.page.details.label")} className="w-full">
          <Textarea readOnly value={details} rows={12} className="max-h-96 w-full font-mono text-xs" />
        </Field>
        <div className="flex max-w-64 flex-row flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => void platform.restart()}>
            {i18n.t(platform.platform === "web" ? "error.page.action.reload" : "error.page.action.restart")}
          </Button>
          {exportLogs && (
            <Button
              size="lg"
              variant="ghost"
              onClick={() =>
                void record()
                  .then(exportLogs)
                  .then(() => setActionError(undefined))
                  .catch(fail)
              }
            >
              {i18n.t("error.page.action.exportLogs")}
            </Button>
          )}
          {platform.updater &&
            (version ? (
              <Button
                size="lg"
                onClick={() =>
                  void platform.updater
                    ?.install()
                    .then(() => setActionError(undefined))
                    .catch(fail)
                }
              >
                {i18n.t("error.page.action.updateTo", { version })}
              </Button>
            ) : (
              <Button
                size="lg"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void platform.updater
                    ?.check()
                    .then((state) => setActionError(state.status === "error" ? state.message : undefined))
                    .catch(fail)
                }
              >
                {updater?.status === "checking"
                  ? i18n.t("error.page.action.checking")
                  : i18n.t("error.page.action.checkUpdates")}
              </Button>
            ))}
        </div>
        {actionError && <p className="ui-note max-w-2xl text-center text-destructive">{actionError}</p>}
        <div className="flex flex-col items-center gap-2 text-center text-xs">
          <div className="flex flex-wrap items-center justify-center gap-1">
            {i18n.t("error.page.report.prefix")}
            <button
              type="button"
              className="text-primary"
              onClick={() => platform.openExternal(BuffLinks.supportMail(i18n.buff.t("Buff Code: app crash")))}
            >
              {BuffLinks.supportAddress}
            </button>
          </div>
          {platform.version && <p className="ui-note">{i18n.t("error.page.version", { version: platform.version })}</p>}
        </div>
      </div>
    </div>
  )
}
