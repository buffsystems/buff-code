// Scanning a pairing QR code (#584), ported from the Solid window's scanner.tsx: the camera preview
// reads codes shown by `opencode pair`, light-on-dark ones too.

import { Button, Callout } from "@buff/ui/react"
import QrScanner from "qr-scanner"
import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { decodePairingCode } from "./address"

export type Pairing = NonNullable<ReturnType<typeof decodePairingCode>>

export function PairingScanner(props: { onScan: (pairing: Pairing) => void; onCancel: () => void }) {
  const i18n = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const latest = useRef(props.onScan)
  latest.current = props.onScan

  useEffect(() => {
    const element = video.current
    if (!element) return
    const scanner = new QrScanner(
      element,
      (result) => {
        const pairing = decodePairingCode(result.data)
        if (!pairing) return setError(i18n.t("server.connect.scan.invalid"))
        scanner.stop()
        latest.current(pairing)
      },
      { preferredCamera: "environment", maxScansPerSecond: 10, returnDetailedScanResult: true },
    )
    scanner.setInversionMode("both")
    void scanner.start().then(
      () => setReady(true),
      () => setError(i18n.t("server.connect.camera.error")),
    )
    return () => scanner.destroy()
  }, [])

  return (
    <section className="flex flex-col gap-5" aria-label={i18n.t("server.connect.scan")}>
      <p className="ui-note">{i18n.t("server.connect.scan.description")}</p>
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
        <video
          ref={video}
          className="size-full object-cover"
          aria-label={i18n.t("server.connect.camera")}
          playsInline
          muted
        />
        {!ready && !error && (
          <span role="status" className="ui-note absolute inset-0 grid place-items-center">
            {i18n.t("server.connect.camera.starting")}
          </span>
        )}
      </div>
      {error && (
        <Callout tone="crit" role="alert">
          {error}
        </Callout>
      )}
      <Button block onClick={props.onCancel}>
        {i18n.t("common.cancel")}
      </Button>
    </section>
  )
}
