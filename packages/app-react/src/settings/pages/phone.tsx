// «Settings → Phone» (#640): pair a phone with this machine's Buff Code — a QR or a link with a
// code, the check code compared on both screens and confirmed here — and manage the paired phones.
// The work is the service's (`buff.mobile`, #639): without it the phone cannot reach the machine.

import {
  BuffCodeHomeNote,
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
  PairedDevices,
  PairingPanel,
  Skeleton,
  SkeletonBlock,
  type PairingMode,
  type PairingPhase,
} from "@buff/ui/react"
import { BuffMobile } from "@opencode/schema/buff-mobile"
import { useCallback, useEffect, useRef, useState } from "react"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { showToast } from "../../shell/notifications/toast"
import { SettingsBody, SettingsHeader, SettingsSection } from "../kit"
import { useSettingsScope } from "../scope"
import { blockOf, homeOf, offerFits, pairingSlot, phaseOf, phoneRows } from "../phone-model"

const POLL_MS = 1500
/** Who is on the line changes by itself (the phones ping every 30 s): the list refreshes too. */
const PHONES_MS = 15_000
const now = () => Math.floor(Date.now() / 1000)
const words = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback

export function SettingsPhone() {
  const i18n = useI18n()
  const t = i18n.buff.t
  const locale = i18n.locale === "ru" ? "ru" : "en"
  const dialog = useDialog()
  const scope = useSettingsScope()
  const [rpc] = useState(() => scope.server.api().rpc(BuffMobile.Rpc))
  const [status, setStatus] = useState<BuffMobile.Status | null>(null)
  const [phones, setPhones] = useState<readonly BuffMobile.Phone[]>([])
  const [mode, setMode] = useState<PairingMode>("qr")
  // The tab on screen, for answers that arrive after a switch (#670); updated before the offer effect runs.
  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  const [offer, setOffer] = useState<BuffMobile.Offer | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Why the service did not answer about the phone (#702): an old service after an update, say.
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [clock, setClock] = useState(now)
  // The offer still open on the service: a new one, or leaving the page, withdraws it.
  const open = useRef<string | null>(null)
  const withdraw = useCallback(() => {
    if (open.current) void rpc.cancel({ offerId: open.current }).catch(() => undefined)
    open.current = null
  }, [rpc])

  const load = useCallback(async () => {
    try {
      const next = await rpc.status(undefined)
      setStatus(next)
      setUnreachable(null)
      if (next.running) setPhones(await rpc.phones(undefined).catch(() => []))
    } catch (err) {
      setStatus(null)
      setUnreachable(t(words(err, "The phone settings did not load.")))
    }
  }, [rpc, t])

  const start = useCallback(
    async (kind: PairingMode) => {
      setError(null)
      withdraw()
      try {
        const next = await rpc.offer({ kind: kind === "qr" ? "qr" : "code" })
        // The tab may have changed meanwhile (#670): an answer for the other mode is stale.
        if (!offerFits(next, modeRef.current)) return
        open.current = next.offerId
        setOffer(next)
      } catch (err) {
        setError(t(words(err, "The pairing did not start.")))
      }
    },
    [rpc, t, withdraw],
  )

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), PHONES_MS)
    return () => clearInterval(timer)
  }, [load])

  // A new offer per mode — a QR carries a secret, the link the code — once pairing is possible.
  const running = status?.running === true
  const blocked = status ? blockOf(status) : null
  const ready = running && !blocked
  useEffect(() => {
    if (ready) void start(mode)
  }, [ready, mode, start])
  useEffect(() => withdraw, [withdraw])

  // Ask the service how the pairing goes while it is under way; tick the countdown.
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(now())
      if (!offer || !BuffMobile.isLive(offer)) return
      rpc.view({ offerId: offer.offerId }).then(
        (next) => {
          setOffer(next)
          if (!BuffMobile.isLive(next)) open.current = null
          if (next.state === "paired") void load()
        },
        () => undefined,
      )
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [offer, rpc, load])

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

  const confirmSas = () =>
    offer &&
    void rpc.confirm({ offerId: offer.offerId }).then(
      (next) => ((open.current = null), setOffer(next), void load()),
      (err: unknown) => setError(t(words(err, "The phone was not confirmed."))),
    )

  const rejectSas = () => void start(mode)

  const disconnect = (device: string) =>
    void act(rpc.revoke({ device }), "The phone was not disconnected.").then(
      (done) => done && showToast({ title: t("Phone"), description: t("The phone is disconnected.") }),
    )

  const rename = (device: string) => {
    const phone = phones.find((item) => item.device === device)
    if (!phone) return
    dialog.show((close) => (
      <RenameDialog
        name={phone.display}
        onCancel={close}
        onSave={(display) => {
          close()
          void act(rpc.rename({ device, display }), "The phone was not renamed.")
        }}
      />
    ))
  }

  const phase: PairingPhase | null = blocked
    ? { kind: "blocked", reason: blocked }
    : offer
      ? phaseOf(offer, clock)
      : null
  const slot = pairingSlot({ phase: phase !== null, error: error !== null, unreachable: unreachable !== null })

  return (
    <>
      <SettingsHeader
        title={t("Phone")}
        description={t("Buff on the phone reaches this machine's Buff Code through {gateway}, end-to-end encrypted.", {
          gateway: status?.gateway ?? "buff.systems",
        })}
      />
      <SettingsBody sectioned>
        {status?.running && <BuffCodeHomeNote home={homeOf(status)} locale={locale} />}
        {error && (
          <Callout tone="crit" role="alert">
            {error}
          </Callout>
        )}
        {status?.running && status.problem && (
          <Callout tone="warn" role="status" title={t("The machine does not reach the gateway")}>
            {status.problem}
          </Callout>
        )}
        <SettingsSection title={t("Pair a phone")}>
          {slot === "panel" && phase ? (
            <PairingPanel
              phase={phase}
              mode={mode}
              locale={locale}
              onModeChange={setMode}
              onNewOffer={() => void start(mode)}
              onConfirmSas={confirmSas}
              onRejectSas={rejectSas}
            />
          ) : slot === "unreachable" ? (
            <>
              <Callout tone="crit" role="alert" title={t("The Buff Code service did not answer about the phone")}>
                {unreachable}{" "}
                {t("If Buff Code was just updated, restart it: the service may still run the previous version.")}
              </Callout>
              <Button variant="primary" size="sm" onClick={() => void load()}>
                {t("Try again")}
              </Button>
            </>
          ) : slot === "retry" ? (
            <Button variant="primary" size="sm" onClick={() => void start(mode)}>
              {t("Try again")}
            </Button>
          ) : (
            <SkeletonBlock label={t("Preparing the pairing")}>
              <Skeleton style={{ width: 160, height: 160, borderRadius: 12 }} />
            </SkeletonBlock>
          )}
        </SettingsSection>
        <AppLinks gateway={status?.gateway ?? "buff.systems"} />
        {running && (
          <SettingsSection title={t("Paired phones")}>
            <PairedDevices
              devices={phoneRows(phones, i18n.intl)}
              locale={locale}
              onRename={rename}
              onDisconnect={disconnect}
            />
          </SettingsSection>
        )}
      </SettingsBody>
    </>
  )
}

/** Where to get the Buff app (#704): the stores and the APK, through the gateway's site. */
function AppLinks(props: { gateway: string }) {
  const t = useI18n().buff.t
  const platform = usePlatform()
  return (
    <SettingsSection title={t("The Buff app")}>
      <p className="text-[13px] text-muted-foreground">
        {t("Install Buff on the phone, then pair it here.")}
      </p>
      <div className="flex flex-wrap gap-2">
        {BuffMobile.appLinks(props.gateway).map((link) => (
          <Button
            key={link.store}
            variant={link.store === "apk" ? "primary" : "secondary"}
            size="sm"
            onClick={() => platform.openExternal(link.url)}
          >
            {link.store === "apk" ? t("Download the APK for Android") : link.name}
          </Button>
        ))}
      </div>
    </SettingsSection>
  )
}

function RenameDialog(props: { name: string; onCancel: () => void; onSave: (name: string) => void }) {
  const t = useI18n().buff.t
  const [name, setName] = useState(props.name)
  const save = () => name.trim() && props.onSave(name.trim())
  return (
    <Dialog open size="sm" title={t("Rename the phone")} onOpenChange={(open) => !open && props.onCancel()}>
      <DialogBody>
        <Input
          autoFocus
          value={name}
          aria-label={t("Phone name")}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={props.onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" disabled={!name.trim()} onClick={save}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
