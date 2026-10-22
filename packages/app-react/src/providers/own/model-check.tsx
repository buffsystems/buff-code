// «Check a model» (#562): a short request to one model of a connected provider — the answer and
// how long it took, or the refusal in the same words as a failed turn (whose problem, what to do,
// the raw answer in the details). Shown right after connecting (and run at once there) and from
// the providers settings. A model that answered becomes the composer's recent pick.

import { Button, Callout, Combobox, Dialog, DialogBody, Spinner } from "@buff/ui/react"
import { BuffModelDefault } from "@opencode/schema/buff-model-default"
import { BuffProvider } from "@opencode/schema/buff-provider"
import { turnFailure } from "@opencode/schema/buff-turn-failure"
import { useEffect, useRef, useState } from "react"
import type { Server } from "../../core/servers"
import type { DialogStack } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useServerData } from "../../react/core"
import { at } from "../../buff/settings/rpc"
import { useProviderCatalog } from "../catalog/use-catalog"
import { modelPreferences } from "../models/preferences"

type Result = BuffProvider.Checked | { error: { type: string; message: string } }
type Choice = { id: string; name?: string; released?: string; tools?: boolean }

/**
 * Which model to check first: the provider's recent pick, the model of the last session if it is
 * this provider's, then the shared default (a well-known vendor's, newest) — never a random entry.
 */
export function defaultCheckModel(input: {
  providerID: string
  models: readonly Choice[]
  recent: readonly string[]
  lastSession?: string
}): string | undefined {
  const known = new Set(input.models.map((model) => model.id))
  return (
    input.recent.find((id) => known.has(id)) ??
    (input.lastSession && known.has(input.lastSession) ? input.lastSession : undefined) ??
    BuffModelDefault.pick(input.models.map((model) => ({ ...model, providerID: input.providerID })))?.id
  )
}

export function ModelCheck(props: {
  server: Server
  directory?: string
  providerID: string
  /** Models known before the catalog has them (a provider just saved). */
  models?: readonly BuffProvider.Model[]
  /** Run the check as soon as a model is known (right after connecting). */
  auto?: boolean
  /** A refused key offers to enter another one here. */
  onReplaceKey?: () => void
}) {
  const t = useI18n().buff.t
  const prefs = modelPreferences(usePlatform().storage)
  const catalog = useProviderCatalog(props.server, props.directory)
  const provider = catalog.catalog.all.get(props.providerID)
  const name = provider?.name ?? props.providerID
  const listed: Choice[] = Object.values(provider?.models ?? {}).map((model) => ({
    id: model.id,
    name: model.name,
    released: model.release_date,
    tools: model.capabilities.toolcall,
  }))
  const models: readonly Choice[] = listed.length ? listed : (props.models ?? [])
  const lastSession = useServerData(props.server, (state) => {
    const last = Object.values(state.session.info)
      .filter((item) => item?.model?.providerID === props.providerID)
      .toSorted((a, b) => (b?.time.updated ?? 0) - (a?.time.updated ?? 0))[0]
    return last?.model?.id
  })
  const fallback = defaultCheckModel({
    providerID: props.providerID,
    models,
    recent: prefs
      .recent()
      .filter((item) => item.providerID === props.providerID)
      .map((item) => item.modelID),
    lastSession,
  })
  const [typed, setTyped] = useState<string>()
  const model = typed ?? fallback ?? ""
  const known = models.some((item) => item.id === model)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Result>()
  const [open, setOpen] = useState(false)

  const run = async (modelID: string) => {
    setRunning(true)
    setResult(undefined)
    const checked = await props.server
      .api()
      .rpc(BuffProvider.Rpc)
      .test({ providerID: props.providerID, modelID }, at(props.directory))
      .catch(
        (error: unknown): Result => ({
          error: { type: "unknown", message: error instanceof Error ? error.message : String(error) },
        }),
      )
    // The model that answered is the one to work with: the composer takes it next.
    if ("text" in checked) prefs.pushRecent({ providerID: props.providerID, modelID })
    setResult(checked)
    setRunning(false)
  }
  const ran = useRef(false)
  useEffect(() => {
    if (!props.auto || ran.current || !fallback) return
    ran.current = true
    void run(fallback)
  }, [props.auto, fallback])
  const failure = result && "error" in result ? turnFailure(result.error, props.providerID, t, name) : undefined

  return (
    <div className="flex flex-col gap-2" data-component="model-check">
      <div className="ui-note">{t("Send a short request to a model to see that the connection works.")}</div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1" data-slot="model-check-model">
          <Combobox
            aria-label={t("Model")}
            value={model}
            disabled={running || models.length === 0}
            placeholder={models.length ? t("Search models") : t("No models yet")}
            options={models.map((item) => ({
              value: item.id,
              label: item.name,
              hint: item.name ? item.id : undefined,
            }))}
            onChange={(value) => {
              setTyped(value)
              setResult(undefined)
            }}
          />
        </div>
        <Button
          variant="outline"
          data-action="model-check"
          disabled={!known || running}
          onClick={() => void run(model)}
        >
          {running ? <Spinner /> : t("Check the model")}
        </Button>
      </div>
      {result && "text" in result && (
        <Callout tone="ok">
          <span data-slot="model-check-ok">
            {t("Works: answered in {seconds} s — «{text}»", {
              seconds: (result.ms / 1000).toFixed(1),
              text: result.text.slice(0, 80) || "…",
            })}
          </span>
        </Callout>
      )}
      {failure && (
        <Callout tone="crit">
          <div className="flex min-w-0 flex-col gap-1">
            <span data-slot="model-check-failure">{failure.text}</span>
            <div className="flex flex-wrap gap-1">
              {failure.action === "replace-key" && props.onReplaceKey && (
                <Button size="sm" variant="outline" data-action="model-check-replace-key" onClick={props.onReplaceKey}>
                  {t("Replace the key")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
                {open ? t("Hide details") : t("Details")}
              </Button>
            </div>
            {open && <pre className="turn-details">{failure.details}</pre>}
          </div>
        </Callout>
      )}
    </div>
  )
}

/** The check alone, from the providers settings. */
export function openModelCheck(
  dialog: DialogStack,
  input: { server: Server; directory?: string; providerID: string; name: string; onReplaceKey?: () => void },
) {
  return dialog.show((close) => <ModelCheckDialog {...input} onClose={close} />)
}

function ModelCheckDialog(props: {
  server: Server
  directory?: string
  providerID: string
  name: string
  onReplaceKey?: () => void
  onClose: () => void
}) {
  const i18n = useI18n()
  const replace = props.onReplaceKey
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={i18n.buff.t("Check {provider}", { provider: props.name })}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <ModelCheck
          server={props.server}
          directory={props.directory}
          providerID={props.providerID}
          onReplaceKey={
            replace &&
            (() => {
              props.onClose()
              replace()
            })
          }
        />
      </DialogBody>
    </Dialog>
  )
}
