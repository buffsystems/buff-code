// «Settings → Phone» (#640): what the pairing panel and the phones list draw, from what this
// machine's service says (`buff.mobile`, #639) and the clock. Pure — the page polls and renders.

import type { BlockReason, BuffCodeHome, PairedDevice, PairingPhase } from "@buff/ui/react"
import type { BuffMobile } from "@opencode/schema/buff-mobile"

/** Offer lifetimes as the service sets them (#631): a QR is scanned at once, a code typed within minutes. */
export const OFFER_TTL_SEC = { qr: 5 * 60, code: 15 * 60 } as const

/** Whether an offer belongs to the tab on screen (#670): a late answer of the other mode is dropped. */
export const offerFits = (offer: Pick<BuffMobile.Offer, "kind">, mode: "qr" | "link"): boolean =>
  offer.kind === (mode === "qr" ? "qr" : "code")

export function phaseOf(offer: BuffMobile.Offer, nowSec: number): PairingPhase {
  const device = { name: offer.phone ?? "", model: "" }
  if (offer.state === "paired") return { kind: "paired", device }
  // The phone scanned or typed and revealed: the codes are compared, and confirmed here.
  if (offer.state === "sas" || offer.state === "confirm") return { kind: "claimed", sas: offer.sas ?? "", device }
  const left = offer.expiresAt - nowSec
  if (left <= 0 || offer.state === "failed") return { kind: "expired" }
  // The panel groups the code 4+4 itself: it gets the bare 8 characters.
  return {
    kind: "offer",
    offer: { link: offer.link, code: (offer.code ?? "").replace(/-/g, ""), ttlSeconds: OFFER_TTL_SEC[offer.kind] },
    secondsLeft: left,
  }
}

export function phoneRows(phones: readonly BuffMobile.Phone[], locale: string): PairedDevice[] {
  const when = (sec: number) =>
    new Date(sec * 1000).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  return phones.map((phone) => ({
    id: phone.device,
    name: phone.display,
    model: "",
    pairedAt: when(phone.paired),
    lastSeen: phone.seen ? when(phone.seen) : "—",
    status: phone.online ? "online" : "offline",
  }))
}

/**
 * What the «Pair a phone» section holds (#702): the panel once there is a phase; a service that did
 * not answer is said so — a skeleton only while the first answer is on its way.
 */
export function pairingSlot(on: { phase: boolean; error: boolean; unreachable: boolean }): "panel" | "unreachable" | "retry" | "waiting" {
  if (on.phase) return "panel"
  if (on.unreachable) return "unreachable"
  return on.error ? "retry" : "waiting"
}

/** Why no phone can pair here now: the service is not running, or the home install forbids phones. */
export function blockOf(status: BuffMobile.Status): BlockReason | null {
  if (!status.running) return "serviceDown"
  if (status.home?.forbidden) return status.home.kind === "saas" ? "org" : "ee"
  return null
}

/** The line over the page: a machine on its own, or one signed into an install whose rules apply. */
export function homeOf(status: BuffMobile.Status): BuffCodeHome {
  return status.home
    ? { kind: "signedIn", install: status.home.name, policyForbids: status.home.forbidden }
    : { kind: "standalone" }
}
