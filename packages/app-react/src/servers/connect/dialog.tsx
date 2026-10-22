// Adding or editing an HTTP server (#584), ported from the Solid window's DialogServer: the address,
// an optional name and the password. The address is checked before it is saved; an edit that
// changes the address replaces the server. On the web a pairing QR code fills the form.

import { Button, Dialog, DialogBody, DialogFooter, Field, Input } from "@buff/ui/react"
import { lazy, Suspense, useState, type KeyboardEvent } from "react"
import type { ServerConnection } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useServerActions } from "../registry/actions"
import { checkServerHealth } from "../registry/health"
import { normalizeServerUrl } from "../registry/registry"
import { isMixedContent } from "./address"
import { useCameraAvailable } from "./camera"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

type Http = Extract<ServerConnection, { type: "http" }>

export function ServerDialog(props: {
  mode: "add" | "edit"
  server?: Http
  onSaved?: (server: Http) => void
  onClose: () => void
}) {
  const i18n = useI18n()
  const platform = usePlatform()
  const actions = useServerActions()
  const camera = useCameraAvailable(props.mode === "add")
  const [values, setValues] = useState({
    url: props.server?.http.url ?? "",
    name: props.server?.displayName ?? "",
    password: props.server?.http.password ?? "",
  })
  const [urls, setUrls] = useState<string[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)

  const save = async (input: typeof values) => {
    const url = normalizeServerUrl(input.url)
    if (!url) return props.onClose()
    const original = props.server
    const name = input.name.trim() || undefined
    const password = input.password || undefined
    const unchanged =
      original && url === original.http.url && name === original.displayName && password === original.http.password
    if (unchanged) return props.onClose()
    const connection: Http = { type: "http", displayName: name, http: { url, password } }
    setBusy(true)
    const result = await checkServerHealth(connection.http, platform.fetch)
    setBusy(false)
    if (!result.healthy) {
      const mixed = platform.platform === "web" && isMixedContent(location.href, url)
      return setError(i18n.t(mixed ? "server.connect.mixedContent" : "dialog.server.add.error"))
    }
    if (original && url !== original.http.url) actions.registry.replace(original.http.url, connection)
    if (!original || url === original.http.url) actions.registry.add(connection)
    props.onSaved?.(connection)
    props.onClose()
  }
  const submit = () => {
    if (busy) return
    setError("")
    void save(values)
  }
  const change = (field: keyof typeof values, value: string) => {
    if (busy) return
    setValues((current) => ({ ...current, [field]: value }))
    setError("")
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const title = i18n.t(props.mode === "add" ? "dialog.server.add.title" : "dialog.server.edit.title")
  const submitLabel = busy
    ? i18n.t("dialog.server.add.checking")
    : i18n.t(props.mode === "add" ? "dialog.server.add.button" : "common.save")

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={title}
      size="sm"
      busy={busy}
      hideClose
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        {scanning ? (
          <Suspense fallback={<p role="status">{i18n.t("server.connect.camera.starting")}</p>}>
            <PairingScanner
              onCancel={() => setScanning(false)}
              onScan={(pairing) => {
                const next = { ...values, url: pairing.urls[0] ?? "", password: pairing.password }
                setValues(next)
                setUrls(pairing.urls)
                setScanning(false)
                void save(next)
              }}
            />
          </Suspense>
        ) : (
          <div className="flex flex-col gap-5">
            <Field label={i18n.t("dialog.server.add.url")} error={error || undefined}>
              <Input
                type="text"
                autoFocus
                value={values.url}
                placeholder={i18n.t("dialog.server.add.placeholder")}
                aria-invalid={!!error || undefined}
                disabled={busy}
                list="dialog-server-addresses"
                onChange={(event) => change("url", event.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
            </Field>
            <datalist id="dialog-server-addresses">
              {urls.map((url) => (
                <option key={url} value={url} />
              ))}
            </datalist>
            <Field label={i18n.t("dialog.server.add.name")}>
              <Input
                type="text"
                value={values.name}
                placeholder={i18n.t("dialog.server.add.namePlaceholder")}
                disabled={busy}
                onChange={(event) => change("name", event.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
            </Field>
            <Field label={i18n.t("dialog.server.add.password")}>
              <Input
                type="password"
                value={values.password}
                placeholder={i18n.t("dialog.server.add.passwordPlaceholder")}
                disabled={busy}
                onChange={(event) => change("password", event.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
            </Field>
            {props.mode === "add" && platform.platform === "web" && (
              <div className="flex flex-col gap-2">
                <Button
                  block
                  disabled={busy || !camera.available}
                  aria-describedby={camera.available || camera.loading ? undefined : "dialog-server-camera"}
                  onClick={() => setScanning(true)}
                >
                  {i18n.t("server.connect.scan")}
                </Button>
                {!camera.available && !camera.loading && (
                  <p id="dialog-server-camera" className="ui-hint">
                    {i18n.t(
                      window.isSecureContext ? "server.connect.camera.unavailable" : "server.connect.camera.insecure",
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogBody>
      {!scanning && (
        <DialogFooter>
          <Button disabled={busy} onClick={props.onClose}>
            {i18n.t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      )}
    </Dialog>
  )
}
