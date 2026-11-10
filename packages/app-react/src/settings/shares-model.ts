// «Settings → Public links» (#817): what the list draws from the machine's links (`buff.share`,
// #816) and the clock. Pure — the page polls and renders.

import type { BuffShare } from "@opencode/schema/buff-share"

export type LinkState = "on" | "off" | "expired" | "pending"

export interface LinkRow {
  id: string
  title: string
  link: string
  /** The source: the session's title now, or that it is gone. */
  source: string | null
  kind: "session" | "messages"
  messages: number
  hasPass: boolean
  expiresAt: number | null
  state: LinkState
  enabled: boolean
  tools: boolean
  live: boolean
}

/** Expired beats everything but a switch-off the person made; unpublished waits for the gateway. */
export function stateOf(link: Pick<BuffShare.Link, "enabled" | "expiresAt" | "published">, nowMs: number): LinkState {
  if (!link.enabled) return "off"
  if (link.expiresAt !== null && link.expiresAt <= nowMs) return "expired"
  if (!link.published) return "pending"
  return "on"
}

export function linkRows(links: readonly BuffShare.Link[], nowMs: number): LinkRow[] {
  return [...links]
    .sort((a, b) => b.created - a.created)
    .map((l) => ({
      id: l.id,
      title: l.title,
      link: l.link,
      source: l.sessionTitle,
      kind: l.kind,
      messages: l.messages,
      hasPass: l.hasPass,
      expiresAt: l.expiresAt,
      state: stateOf(l, nowMs),
      enabled: l.enabled,
      tools: l.tools,
      live: l.live,
    }))
}

/** When a link ends, for a person: a date and time in their locale; null — never. */
export function expiryLabel(expiresAt: number | null, locale: string): string | null {
  if (expiresAt === null) return null
  return new Date(expiresAt).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}
