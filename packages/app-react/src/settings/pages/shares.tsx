// «Settings → Public links» (#817, epic #769): the links this machine's Buff Code published —
// change a link's title, password or expiry, switch it off and on, delete it, copy its address.
// The work is the service's (`buff.share`, #816): the page reads from this machine while it runs.

import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  CopyField,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  Panel,
  Select,
  Skeleton,
  SkeletonBlock,
  Switch,
  type BadgeTone,
} from "@buff/ui/react"
import { BuffShare } from "@opencode/schema/buff-share"
import { useCallback, useEffect, useState } from "react"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { expiryLabels } from "../../session/share/share-dialog"
import { expiresAtFor, type ExpiryPreset } from "../../session/share/model"
import { showToast } from "../../shell/notifications/toast"
import { SettingsBody, SettingsHeader, SettingsSection } from "../kit"
import { useSettingsScope } from "../scope"
import { expiryLabel, linkRows, type LinkRow, type LinkState } from "../shares-model"

/** The list follows the machine: the gateway may publish a waiting link, a link may expire. */
const REFRESH_MS = 15_000
const words = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback

export function SettingsShares() {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const platform = usePlatform()
  const scope = useSettingsScope()
  const [rpc] = useState(() => scope.server.api().rpc(BuffShare.Rpc))
  const [status, setStatus] = useState<BuffShare.Status | null>(null)
  const [links, setLinks] = useState<readonly BuffShare.Link[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await rpc.status(undefined)
      setStatus(next)
      setUnreachable(null)
      setLinks(next.running ? await rpc.list(undefined) : [])
    } catch (err) {
      setStatus(null)
      setUnreachable(t(words(err, "Public links did not load.")))
    }
  }, [rpc, t])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const act = async (call: Promise<unknown>, fallback: string) => {
    try {
      await call
      await load()
      return true
    } catch (err) {
      setError(t(words(err, fallback)))
      return false
    }
  }

  const toggle = (row: LinkRow, enabled: boolean) =>
    void act(rpc.update({ id: row.id, enabled }), "The link was not saved.")

  const remove = (row: LinkRow) =>
    dialog.show((close) => (
      <ConfirmDialog
        open
        danger
        title={t("Delete the link?")}
        message={t("The page will say the dialog was removed by its owner.")}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        onCancel={close}
        onConfirm={() => {
          close()
          void act(rpc.remove({ id: row.id }), "The link was not deleted.").then(
            (done) => done && showToast({ title: t("Public links"), description: t("The link is deleted.") }),
          )
        }}
      />
    ))

  const edit = (row: LinkRow) =>
    dialog.show((close) => (
      <EditLinkDialog
        row={row}
        onCancel={close}
        onSave={(patch) => {
          close()
          void act(rpc.update({ id: row.id, ...patch }), "The link was not saved.")
        }}
      />
    ))

  const rows = links ? linkRows(links, Date.now()) : null

  return (
    <>
      <SettingsHeader
        title={t("Public links")}
        description={t(
          "Links of this machine's Buff Code live at {gateway}; a page reads the dialog from this machine when it opens — while Buff Code runs.",
          {
            gateway: status?.gateway ?? "buff.systems",
          },
        )}
      />
      <SettingsBody sectioned>
        {error && (
          <Callout tone="crit" role="alert">
            {error}
          </Callout>
        )}
        {unreachable && (
          <>
            <Callout tone="crit" role="alert" title={t("The Buff Code service did not answer about the links")}>
              {unreachable}
            </Callout>
            <Button variant="primary" size="sm" onClick={() => void load()}>
              {t("Try again")}
            </Button>
          </>
        )}
        {status && !status.running && (
          <Callout tone="warn" role="status">
            {t("The Buff Code service is not running — public links are made and shown through it.")}
          </Callout>
        )}
        {status?.running && status.problem && (
          <Callout tone="warn" role="status" title={t("The machine does not reach the gateway")}>
            {status.problem}
          </Callout>
        )}
        <SettingsSection title={t("Links")}>
          {rows === null && !unreachable ? (
            <SkeletonBlock label={t("Loading the links")}>
              <Skeleton style={{ width: "100%", height: 56, borderRadius: 12 }} />
            </SkeletonBlock>
          ) : rows && rows.length === 0 ? (
            <EmptyState>
              <span className="text-[13px] font-medium">{t("No public links yet.")}</span>
              <span className="text-[12px] text-muted-foreground">
                {t("Share a session from its menu or a message's actions.")}
              </span>
            </EmptyState>
          ) : (
            rows && (
              <Panel data-component="share-links">
                {rows.map((row) => (
                  <LinkCard
                    key={row.id}
                    row={row}
                    locale={i18n.intl}
                    onToggle={(enabled) => toggle(row, enabled)}
                    onEdit={() => edit(row)}
                    onDelete={() => remove(row)}
                    onOpen={() => platform.openExternal(row.link)}
                  />
                ))}
              </Panel>
            )
          )}
        </SettingsSection>
      </SettingsBody>
    </>
  )
}

const tones: Record<LinkState, BadgeTone> = { on: "ok", off: "neutral", expired: "warn", pending: "info" }

function LinkCard(props: {
  row: LinkRow
  locale: string
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onOpen: () => void
}) {
  const t = useI18n().buff.t
  const { row } = props
  const stateLabel: Record<LinkState, string> = {
    on: t("Turned on"),
    off: t("Turned off"),
    expired: t("Expired"),
    pending: t("Not yet published"),
  }
  const expiry = expiryLabel(row.expiresAt, props.locale)
  const meta = [
    row.source === null ? t("Deleted session") : row.source,
    row.kind === "messages" ? t("Messages: {count}", { count: row.messages }) : t("Whole dialog"),
    row.hasPass ? t("With password") : t("No password"),
    expiry ? t("Expires {when}", { when: expiry }) : t("Never expires"),
    ...(row.tools ? [t("With tool calls")] : []),
    ...(row.live ? [t("Live")] : []),
  ].join(" · ")
  return (
    <div data-component="share-link" className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium">{row.title}</span>
          <span className="truncate text-[12px] text-muted-foreground">{meta}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={tones[row.state]} size="sm">
            {stateLabel[row.state]}
          </Badge>
          <Switch checked={row.enabled} onCheckedChange={props.onToggle} aria-label={t("Public access")} />
        </div>
      </div>
      <CopyField value={row.link} mono compact copyLabel={t("Copy the link")} copiedLabel={t("Copied")} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          {t("Open")}
        </Button>
        <Button variant="secondary" size="sm" onClick={props.onEdit}>
          {t("Edit")}
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDelete}>
          {t("Delete")}
        </Button>
      </div>
    </div>
  )
}

type Patch = Omit<BuffShare.UpdateInput, "id">

function EditLinkDialog(props: { row: LinkRow; onCancel: () => void; onSave: (patch: Patch) => void }) {
  const t = useI18n().buff.t
  const [title, setTitle] = useState(props.row.title)
  const [pass, setPass] = useState("")
  const [dropPass, setDropPass] = useState(false)
  const [expiry, setExpiry] = useState<ExpiryPreset | "keep">("keep")
  const [tools, setTools] = useState(props.row.tools)
  const [live, setLive] = useState(props.row.live)
  const labels = expiryLabels(t)
  const save = () => {
    if (!title.trim()) return
    props.onSave({
      title: title.trim(),
      ...(dropPass ? { pass: null } : pass ? { pass } : {}),
      ...(expiry === "keep" ? {} : { expiresAt: expiresAtFor(expiry, Date.now()) }),
      tools,
      live,
    })
  }
  return (
    <Dialog open size="md" title={t("Edit the link")} onOpenChange={(open) => !open && props.onCancel()}>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <Field label={t("Link title")}>
            <Input autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} />
          </Field>
          <Field label={t("New password (leave empty to keep)")}>
            <Input
              type="password"
              value={pass}
              disabled={dropPass}
              autoComplete="new-password"
              onChange={(event) => setPass(event.currentTarget.value)}
            />
          </Field>
          {props.row.hasPass && (
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span>{t("Remove the password")}</span>
              <Switch checked={dropPass} onCheckedChange={setDropPass} />
            </label>
          )}
          <Field label={t("Expires")}>
            <Select value={expiry} onChange={(event) => setExpiry(event.currentTarget.value as ExpiryPreset | "keep")}>
              <option value="keep">{t("Keep as is")}</option>
              {BuffShare.EXPIRY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {labels[p.id as ExpiryPreset]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>{t("Show AI tool calls and their results")}</span>
            <Switch checked={tools} onCheckedChange={setTools} />
          </label>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>{t("Follow the session live")}</span>
            <Switch checked={live} onCheckedChange={setLive} />
          </label>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={props.onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" disabled={!title.trim()} onClick={save}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
