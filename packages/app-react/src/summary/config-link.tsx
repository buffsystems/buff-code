// «Configuration file» at the foot of a service menu (#584), ported from the Solid
// ServiceConfigLink: on this machine it reveals the file that configures the service (or opens its
// folder); on a remote server it copies the file's path, with «Copy»/«Copied» over its icon.

import { Tooltip } from "@buff/ui/react"
import { getDirectory } from "@opencode/util/path"
import { Check, Copy, Settings, SquareArrowOutUpRight } from "lucide-react"
import { useState } from "react"
import { isLocalServer, type Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useCopied } from "../session/timeline/parts/text"
import { showToast } from "../shell/notifications/toast"

export type Service = "mcp" | "plugins" | "skills" | "lsp"

export function ConfigLink(props: { server: Server; directory: string; service: Service }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const local = isLocalServer(props.server.conn)
  const [opening, setOpening] = useState(false)
  const [copied, markCopied] = useCopied()
  const [pointed, setPointed] = useState(false)
  const label = i18n.t(local ? "session.summary.configure" : "session.summary.copyConfigPath")
  const reveal = platform.revealPath

  const activate = async () => {
    if (opening || (local && !reveal)) return
    setOpening(true)
    await props.server
      .api()
      .config.get({ location: { directory: props.directory } })
      .then(async (entries) => {
        const documents = entries
          .filter((entry) => entry.type === "document")
          .filter((entry) => entry.path !== undefined && /\.jsonc?$/.test(entry.path))
        const path =
          documents.findLast((entry) => entry.info[props.service] !== undefined)?.path ?? documents.at(-1)?.path
        if (!local) {
          if (!path) throw new Error(i18n.t("session.summary.configFileMissing"))
          // The page's clipboard API, not a selected textarea: focus leaving the menu would close it.
          await (platform.writeClipboardText?.(path) ?? navigator.clipboard.writeText(path))
          markCopied()
          return
        }
        if (path && (await reveal?.(path))) return
        await platform.openPath?.(path ? getDirectory(path) : props.directory)
      })
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setOpening(false))
  }

  return (
    <>
      <span className="session-service-config-separator" role="separator" />
      {local && !reveal ? (
        <span className="session-service-row">
          <Settings aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {label}
        </span>
      ) : (
        <button
          type="button"
          className="session-service-row session-service-config"
          disabled={opening}
          onPointerEnter={() => setPointed(true)}
          onPointerLeave={() => setPointed(false)}
          onFocus={() => setPointed(true)}
          onBlur={() => setPointed(false)}
          onMouseDown={(event) => {
            if (!local) event.preventDefault()
          }}
          onClick={() => void activate()}
        >
          {local ? (
            <Settings aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            // «Copy»/«Copied» over the icon, held open while the copy is reported.
            <Tooltip
              side="top"
              open={pointed || copied}
              content={i18n.t(copied ? "ui.message.copied" : "ui.message.copy")}
            >
              <span className="flex shrink-0">
                {copied ? (
                  <Check aria-hidden className="size-4 text-muted-foreground" />
                ) : (
                  <Copy aria-hidden className="size-4 text-muted-foreground" />
                )}
              </span>
            </Tooltip>
          )}
          <span className="session-summary-label min-w-0 flex-1 truncate">{label}</span>
          {local && <SquareArrowOutUpRight aria-hidden className="session-service-config-arrow size-3.5 shrink-0" />}
        </button>
      )}
    </>
  )
}
