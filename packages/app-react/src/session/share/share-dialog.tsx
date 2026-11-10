// «Share…» (#817, epic #769): a public link to this session — the whole dialog or the messages
// picked here — made by this machine's service (`buff.share`, #816). The page at the gateway
// reads the content from this machine while Buff Code runs; nothing is stored at buff.systems.

import {
  Button,
  Callout,
  Checkbox,
  CopyField,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Segmented,
  Select,
  Switch,
} from "@buff/ui/react"
import { BuffShare } from "@opencode/schema/buff-share"
import { useMemo, useState } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useServerData } from "../../react/core"
import { createInput, defaultTitle, previews, type ExpiryPreset } from "./model"

const words = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback

/** The expiry presets as the person reads them. */
export function expiryLabels(t: (text: string) => string): Record<ExpiryPreset, string> {
  return {
    none: t("Never"),
    "1h": t("In an hour"),
    "1d": t("In a day"),
    "7d": t("In 7 days"),
    "30d": t("In 30 days"),
  }
}

export function ShareDialog(props: {
  server: Server
  sessionID: string
  preselect?: readonly string[]
  onClose: () => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const platform = usePlatform()
  const [rpc] = useState(() => props.server.api().rpc(BuffShare.Rpc))
  const sessionTitle = useServerData(props.server, (state) => state.session.info[props.sessionID]?.title)
  const messages = useServerData(props.server, (state) => state.session.message[props.sessionID])
  const list = useMemo(() => previews(messages ?? []), [messages])
  const [mode, setMode] = useState<"all" | "some">(props.preselect?.length ? "some" : "all")
  const [selected, setSelected] = useState<Set<string>>(() => new Set(props.preselect ?? []))
  const [title, setTitle] = useState(() => defaultTitle(sessionTitle, t("Untitled")))
  const [pass, setPass] = useState("")
  const [expiry, setExpiry] = useState<ExpiryPreset>("none")
  const [tools, setTools] = useState(false)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<BuffShare.Link | null>(null)
  const labels = expiryLabels(t)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const create = async () => {
    const input = createInput({
      session: props.sessionID,
      mode,
      selected,
      title,
      pass,
      expiry,
      tools,
      live,
      nowMs: Date.now(),
    })
    if ("error" in input) {
      setError(input.error === "title" ? t("The title is required") : t("Select at least one message"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      setMade(await rpc.create(input))
    } catch (err) {
      setError(t(words(err, "The link was not created.")))
    } finally {
      setBusy(false)
    }
  }

  if (made) {
    return (
      <Dialog
        open
        size="md"
        title={t("The link is ready")}
        busy={busy}
        onOpenChange={(open) => !open && props.onClose()}
      >
        <DialogBody>
          <div className="flex flex-col gap-3">
            <CopyField value={made.link} mono copyLabel={t("Copy the link")} copiedLabel={t("Copied")} />
            {!made.hasPass && (
              <Callout tone="warn" role="status">
                {t("Anyone with the link can open it: there is no password.")}
              </Callout>
            )}
            <p className="text-[13px] text-muted-foreground">
              {t(
                "The page reads the dialog from this machine while Buff Code runs; the links are managed in Settings → Public links.",
              )}
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => platform.openExternal(made.link)}>
            {t("Open")}
          </Button>
          <Button variant="primary" onClick={props.onClose}>
            {t("Done")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <Dialog open size="md" title={t("Public link")} busy={busy} onOpenChange={(open) => !open && props.onClose()}>
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="share-dialog">
          <Segmented<"all" | "some">
            label={t("What to share")}
            value={mode}
            onChange={setMode}
            options={[
              { id: "all", label: t("Whole dialog") },
              { id: "some", label: t("Selected messages") },
            ]}
          />
          {mode === "some" && (
            <div
              className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2"
              data-slot="share-messages"
            >
              {list.length === 0 && (
                <span className="text-[13px] text-muted-foreground">{t("No messages to share yet.")}</span>
              )}
              {list.map((m) => (
                <Checkbox
                  key={m.id}
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                  label={
                    <span className="text-[13px]">
                      <span className="text-muted-foreground">{m.role === "user" ? t("You") : t("Assistant")}: </span>
                      {m.text}
                    </span>
                  }
                />
              ))}
            </div>
          )}
          <Field label={t("Link title")}>
            <Input value={title} maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} />
          </Field>
          <Field label={t("Password (optional)")} hint={t("Without a password anyone with the link opens the page.")}>
            <Input
              type="password"
              value={pass}
              autoComplete="new-password"
              onChange={(event) => setPass(event.currentTarget.value)}
            />
          </Field>
          <Field label={t("Expires")}>
            <Select value={expiry} onChange={(event) => setExpiry(event.currentTarget.value as ExpiryPreset)}>
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
          {error && (
            <Callout tone="crit" role="alert">
              {error}
            </Callout>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" onClick={() => void create()} disabled={busy}>
          {t("Create the link")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
