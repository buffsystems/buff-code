// «No model» over the composer (#457), ported from the Solid window's no-model.tsx: while there is
// no model to send with, say why and what to do — sign in to Buff or connect one's own provider
// (#562), or choose the organization and project. A model of one's own provider is a model: then
// nothing is said. The words are the console's (`BuffFirstRun.noModel`). The session composer and
// the draft mount it with their server and directory.

import { Button } from "@buff/ui/react"
import { BUFF_PROVIDER, buffSignedIn } from "@opencode/app/react-reuse/buff-providers"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { TriangleAlert } from "lucide-react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useProviderCatalog } from "../../providers/catalog/use-catalog"
import { openConnectProvider } from "../../providers/connect/open"
import { useBuffContextChoice, useBuffContextValue } from "../context/choice"
import "../bar.css"

export function BuffNoModelStrip(props: { server: Server; directory: string }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const context = useBuffContextChoice(props.server, props.directory)
  const catalog = useProviderCatalog(props.server, props.directory)
  const [choice, setChoice] = useBuffContextValue(props.server, props.directory)
  // Unknown yet: the strip does not flash while loading.
  const state =
    !catalog.ready || choice === undefined
      ? undefined
      : BuffFirstRun.noModel({
          signedIn: buffSignedIn(catalog.integrations),
          context: !!choice,
          models: catalog.paid.some((provider) => provider.id === BUFF_PROVIDER),
          own: catalog.paid.some((provider) => provider.id !== BUFF_PROVIDER),
        })
  if (!state) return null
  const fix = async () => {
    if (state.action === "sign-in") return void context.signIn()
    const kept = await context.choose(choice ?? null)
    if (kept) setChoice(kept)
  }
  return (
    <div className="buff-bar" data-component="buff-no-model" data-action-kind={state.action} data-tone="warning">
      <TriangleAlert aria-hidden className="buff-bar__icon" />
      <span className="buff-bar__text">{t(state.text)}</span>
      <Button size="sm" variant="primary" data-action="buff-no-model-fix" onClick={() => void fix()}>
        {state.action === "sign-in" ? t("Sign in to Buff") : t("Choose context")}
      </Button>
      {state.action === "sign-in" && (
        <Button
          size="sm"
          variant="ghost"
          data-action="buff-no-model-connect"
          onClick={() => openConnectProvider(dialog, { server: props.server, directory: props.directory })}
        >
          {i18n.t("command.provider.connect")}
        </Button>
      )}
    </div>
  )
}
