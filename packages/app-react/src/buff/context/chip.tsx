// Buff's working context (#391), ported from the Solid window's context-chip.tsx: «◆ organization ›
// project» under the composer. A click chooses from what is allowed, the same steps as the terminal;
// a directory without a context asks by itself; signed out, the chip offers sign-in — opening it by
// itself unless the introduction is about to (#457) or one's own provider is there to work with (#562). A switch made in the console or the terminal
// arrives as an event. The session composer and the draft mount it.

import { Button, cx } from "@buff/ui/react"
import { BUFF_PROVIDER, buffSignedIn } from "@opencode/app/react-reuse/buff-providers"
import { BuffContext } from "@opencode/schema/buff-context"
import { launchStep } from "@opencode/schema/buff-context-flow"
import { useEffect, useRef, useState } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { useProviderCatalog } from "../../providers/catalog/use-catalog"
import { showToast } from "../../shell/notifications/toast"
import { onboardingPending } from "../onboarding/state"
import { useBuffContextChoice, useBuffContextValue } from "./choice"
import "../bar.css"

const message = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)
const failure = (error: unknown) => ({
  type: typeof error === "object" && error !== null && "type" in error ? String(error.type) : undefined,
  message: message(error),
})

export function BuffContextChip(props: { server: Server; directory: string }) {
  const t = useI18n().buff.t
  const context = useBuffContextChoice(props.server, props.directory)
  const connected = useConnection(props.server).status === "connected"
  const [choice, setChoice] = useBuffContextValue(props.server, props.directory)
  const [signedOut, setSignedOut] = useState(false)
  const catalog = useProviderCatalog(props.server, props.directory)
  const signedIn = buffSignedIn(catalog.integrations)
  const own = catalog.paid.some((provider) => provider.id !== BUFF_PROVIDER)

  const choose = async () => {
    const kept = await context.choose(choice ?? null)
    if (kept) setChoice(kept)
  }
  // When the sign-in closes, everything is checked again — but the sign-in does not open a second
  // time by itself: the chip offers it.
  const signIn = () => context.signIn(() => void launch(false).catch(() => undefined))
  const launch = async (openSignIn: boolean) => {
    const saved = await context.rpc.get(undefined, context.at).catch(() => null)
    setChoice(saved)
    const problem = await context.rpc.options(undefined, context.at).then(() => undefined, failure)
    const step = launchStep(saved, problem)
    setSignedOut(step === "sign_in")
    // #457: on the first launch the introduction signs in, not the chip; #562: one's own provider
    // works without Buff — the chip only offers it then.
    if (step === "sign_in") return openSignIn && !onboardingPending.get() && !own ? signIn() : undefined
    if (step === "unreachable") return showToast({ title: t("Buff context"), description: problem?.message })
    // The first run in a directory always asks (#391).
    if (step === "choose") await choose()
  }
  const latest = useRef(launch)
  latest.current = launch
  // After the catalog: whether one's own provider is there decides if the sign-in opens (#562).
  useEffect(() => {
    if (connected && catalog.ready) void latest.current(true).catch(() => undefined)
  }, [connected, catalog.ready, props.server, props.directory])
  // #457: signing in elsewhere (the no-model strip, the introduction) lets the chip offer the choice.
  const before = useRef(signedIn)
  useEffect(() => {
    const was = before.current
    before.current = signedIn
    if (signedIn && !was && signedOut) void latest.current(false).catch(() => undefined)
  }, [signedIn, signedOut])

  return (
    <Button
      data-action="buff-context"
      variant="ghost"
      size="sm"
      className={cx("composer-chip", ((signedOut && !own) || (!signedOut && !choice)) && "composer-chip--warning")}
      title={t("Buff working context: organization, project, knowledge spaces")}
      onClick={() => (signedOut ? signIn() : void choose())}
    >
      <span className="truncate">
        ◆ {signedOut ? t("Sign in to Buff") : choice ? BuffContext.label(choice, t) : t("Choose a Buff context")}
      </span>
    </Button>
  )
}
