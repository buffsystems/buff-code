// The update notice (#584): a small button in the titlebar or the sidebar's footer once an update
// is ready; a stable download asks first. Reads the desktop updater from the platform.

import { Chip, ConfirmDialog, Spinner } from "@buff/ui/react"
import { ArrowDown } from "lucide-react"
import { useSyncExternalStore } from "react"
import { createStore } from "../../core/store"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import type { UpdaterState } from "../../platform/platform"
import { showToast } from "../notifications/toast"
import { updaterAction, updateNotice } from "./updater"

const none = createStore<UpdaterState | undefined>(undefined)

export function useUpdaterState() {
  const updater = usePlatform().updater
  const store = updater?.state ?? none
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useUpdaterInstall() {
  const platform = usePlatform()
  const dialog = useDialog()
  const i18n = useI18n()
  const download = () =>
    platform.updater?.install().catch((error: unknown) =>
      showToast({
        title: i18n.t("common.requestFailed"),
        description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
      }),
    )
  return () => {
    const state = platform.updater?.state.get()
    if (state?.status !== "download-required") return void download()
    dialog.show((close) => (
      <ConfirmDialog
        open
        title={i18n.t("settings.updates.migration.title")}
        message={i18n.t("settings.updates.migration.description", { version: state.version })}
        confirmLabel={i18n.t("settings.updates.action.download")}
        cancelLabel={i18n.t("common.cancel")}
        onCancel={close}
        onConfirm={() => {
          close()
          void download()
        }}
      />
    ))
  }
}

/** Check for an update: a stable download asks first, the result or the failure is a toast. */
export function useUpdaterCheck() {
  const platform = usePlatform()
  const i18n = useI18n()
  const install = useUpdaterInstall()
  return async () => {
    const result = await platform.updater?.check()
    if (result?.status === "download-required") return install()
    if (result?.status === "up-to-date")
      showToast({
        variant: "success",
        title: i18n.t("settings.updates.toast.latest.title"),
        description: i18n.t("settings.updates.toast.latest.description", { version: platform.version ?? "" }),
      })
    if (result?.status === "error") showToast({ title: i18n.t("common.requestFailed"), description: result.message })
  }
}

export function UpdateButton(props: { vertical?: boolean }) {
  const i18n = useI18n()
  const state = useUpdaterState()
  const install = useUpdaterInstall()
  const notice = updateNotice(state)
  if (!notice.visible) return null
  return (
    <div data-slot="titlebar-update" className={props.vertical ? "self-start" : "me-3"}>
      <Chip
        className="gap-1 text-primary"
        disabled={notice.installing}
        aria-busy={notice.installing}
        aria-label={i18n.t(updaterAction(state).label)}
        title={notice.version ? i18n.t("titlebar.updateVersion", { version: notice.version }) : undefined}
        onClick={install}
      >
        {notice.installing ? <Spinner size={12} /> : <ArrowDown aria-hidden className="size-3.5" />}
        <span>{i18n.t("titlebar.update")}</span>
      </Chip>
    </div>
  )
}
