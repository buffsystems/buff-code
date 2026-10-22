// Buff's turn cards in the timeline (#584): the changes a finished turn made with its rewind
// (#449) — the rewind asks first, showing what comes back and which files someone changed after
// the turn — and a failed turn's card with its reason and the way out (#458).

import { Button, Callout, Dialog, DialogBody, DialogFooter } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { SessionTurnFailure } from "@opencode/session-ui/actions"
import { BuffTurn } from "@opencode/schema/buff-turn"
import { turnFailure } from "@opencode/schema/buff-turn-failure"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { useBuffBillingDialog } from "../../buff/billing/billing"
import { useBuffContextChoice } from "../../buff/context/choice"
import { useProviderCatalog } from "../../providers/catalog/use-catalog"
import { openConnectProvider } from "../../providers/connect/open"
import { writeClipboard } from "./parts/text"

function FileRow(props: { file: BuffTurn.File; onOpen?: (path: string) => void }) {
  const i18n = useI18n()
  return (
    <button
      type="button"
      className="turn-file"
      data-external={props.file.external}
      disabled={!props.onOpen}
      onClick={() => props.onOpen?.(props.file.file)}
    >
      <span className="turn-file__name">{props.file.file}</span>
      {props.file.external && <span className="turn-file__external">{i18n.buff.t("changed after the turn")}</span>}
      <span className="turn-file__note">{BuffTurn.fileNote(props.file, i18n.buff.t)}</span>
    </button>
  )
}

/** Under a finished turn's answer: the files it changed, unfolding into a list, and its rewind. */
export function TurnSummary(props: {
  server: Server
  sessionID: string
  userMessageID: string
  onOpenFile?: (path: string) => void
  onRevert: () => void
}) {
  const i18n = useI18n()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<BuffTurn.File[]>([])
  useEffect(() => {
    const current = { cancelled: false }
    void props.server
      .api()
      .session.diff({ sessionID: props.sessionID, from: props.userMessageID, context: 0 })
      .then(
        (diffs) => diffs.map((diff): BuffTurn.File => ({ ...diff, external: false })),
        () => [],
      )
      .then((list) => {
        if (!current.cancelled) setFiles(list)
      })
    return () => {
      current.cancelled = true
    }
  }, [props.server, props.sessionID, props.userMessageID])
  const line = BuffTurn.changedLine(files, i18n.buff.n)
  if (!line) return null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="turn-summary" data-component="buff-turn-summary">
      <div className="flex items-center gap-2">
        <button type="button" className="turn-summary__toggle" data-action="buff-turn-toggle" onClick={() => setOpen(!open)}>
          <Chevron aria-hidden className="size-3.5 shrink-0" />
          <span>{line}</span>
        </button>
        <Button size="sm" variant="ghost" data-action="buff-turn-revert" onClick={props.onRevert}>
          {i18n.buff.t("Rewind the turn")}
        </Button>
      </div>
      {open && (
        <div className="turn-files">
          {files.map((file) => (
            <FileRow key={file.file} file={file} onOpen={props.onOpenFile} />
          ))}
        </div>
      )}
    </div>
  )
}

type Choice = { files: boolean } | undefined

function RevertDialog(props: { preview: BuffTurn.Preview; problem?: string; onChoice: (choice: Choice) => void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const verdict = BuffTurn.verdict(props.preview, t, i18n.buff.n)
  return (
    <Dialog
      open
      title={props.problem ? t("Rewind the turn?") : verdict.title}
      closeLabel={i18n.t("ui.common.close")}
      onOpenChange={(open) => !open && props.onChoice(undefined)}
    >
      <DialogBody>
        <div className="flex flex-col gap-3" data-component="buff-turn-revert" data-safe={verdict.safe}>
          <span>
            {props.problem
              ? t("Could not check which files come back: {problem} The rewind is still possible.", {
                  problem: props.problem,
                })
              : verdict.text}
          </span>
          {props.preview.files.length > 0 && (
            <div className="turn-files">
              {props.preview.files.map((file) => (
                <FileRow key={file.file} file={file} />
              ))}
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => props.onChoice(undefined)}>
          {t("Cancel")}
        </Button>
        {props.preview.files.length > 0 && (
          <Button variant="outline" data-action="buff-turn-revert-chat" onClick={() => props.onChoice({ files: false })}>
            {t("Only the conversation")}
          </Button>
        )}
        <Button
          variant={verdict.safe ? "primary" : "destructive"}
          data-action="buff-turn-revert-confirm"
          onClick={() => props.onChoice({ files: true })}
        >
          {verdict.safe ? t("Rewind") : t("Rewind and overwrite the edits")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Ask before a rewind: what comes back and whether files are restored; undefined cancels. */
export function useRevertConfirm(server: Server, sessionID: string, directory: () => string) {
  const dialog = useDialog()
  const i18n = useI18n()
  return async (message: SessionMessageUser): Promise<Choice> => {
    const failure: { problem?: string } = {}
    const preview = await server
      .api()
      .rpc(BuffTurn.Rpc)
      .preview({ sessionID, messageID: message.id }, { location: { directory: directory() } })
      .catch((error: unknown): BuffTurn.Preview => {
        failure.problem = formatServerError(error, undefined, i18n.buff.t("the service did not answer."))
        return { snapshots: true, files: [] }
      })
    return new Promise<Choice>((resolve) => {
      const settled = { value: false }
      dialog.show((close) => (
        <RevertDialog
          preview={preview}
          problem={failure.problem}
          onChoice={(choice) => {
            if (settled.value) return
            settled.value = true
            resolve(choice)
            close()
          }}
        />
      ))
    })
  }
}

const fixes = {
  "sign-in": "Sign in again",
  "choose-context": "Choose context",
  "top-up": "Balance and cabinet",
  "replace-key": "Replace the key",
  "connect-provider": "Connect the provider",
} as const

/** A failed turn (#458): the reason in words, retry, the fix that applies, and the raw details. */
export function TurnFailure(props: {
  server: Server
  directory: string
  sessionID: string
  failure: SessionTurnFailure
  onRetry: () => void | Promise<void>
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const context = useBuffContextChoice(props.server, props.directory)
  const billing = useBuffBillingDialog(props.server, props.directory, props.sessionID)
  const dialog = useDialog()
  const catalog = useProviderCatalog(props.server, props.directory)
  const [open, setOpen] = useState(false)
  const providerID = props.failure.providerID
  const provider = catalog.catalog.all.get(providerID)?.name
  const failure = turnFailure(props.failure, providerID, t, provider)
  const copy = async () => {
    if (!(await writeClipboard(failure.details))) return
    showToast({ title: t("Copied"), description: t("The error details are in the clipboard") })
  }
  const fix = async () => {
    if (failure.action === "sign-in") return context.signIn()
    if (failure.action === "top-up") return billing()
    if (failure.action === "replace-key" || failure.action === "connect-provider")
      return openConnectProvider(dialog, { server: props.server, directory: props.directory, provider: providerID })
    const current = await context.rpc.get(undefined, { location: { directory: props.directory } }).catch(() => null)
    await context.choose(current)
  }
  return (
    <div data-kind="session-error-card">
      <Callout tone="crit">
        <div className="flex w-full min-w-0 flex-col gap-2">
          <div className="min-w-0">{failure.text}</div>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="outline" data-action="turn-retry" onClick={() => void props.onRetry()}>
              {t("Retry")}
            </Button>
            {failure.action && (
              <Button size="sm" variant="outline" data-action="turn-fix" onClick={() => void fix()}>
                {t(fixes[failure.action])}
              </Button>
            )}
            <Button size="sm" variant="ghost" data-action="turn-details" onClick={() => setOpen(!open)}>
              {open ? t("Hide details") : t("Details")}
            </Button>
            <Button size="sm" variant="ghost" data-action="turn-copy" onClick={() => void copy()}>
              {t("Copy")}
            </Button>
          </div>
          {open && (
            <pre className="turn-details" data-slot="turn-details">
              {failure.details}
            </pre>
          )}
        </div>
      </Callout>
    </div>
  )
}
