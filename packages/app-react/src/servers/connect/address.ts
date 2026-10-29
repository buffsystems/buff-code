// Server addresses for the connect dialog (#584), copied from the Solid window's connect/pairing.ts
// and connect/browser.ts (they import the Solid registry for normalizeServerUrl): a scanned pairing
// code's addresses, and an http:// server a https:// page cannot reach.

import { Option, Schema } from "effect"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"
import { normalizeServerUrl } from "../registry/registry"

const pairing = Schema.fromJsonString(
  Schema.Struct({
    urls: Schema.Array(Schema.String),
    // Код сопряжения новых выпусков несёт имя Buff, прежних — `opencode`.
    username: Schema.Literals(BuffServerAuth.USERNAMES),
    password: Schema.String,
  }),
)

export function serverAddress(value: string) {
  if (value.includes("://") && !/^https?:\/\//.test(value.trim())) return undefined
  const normalized = normalizeServerUrl(value)
  if (!normalized || !URL.canParse(normalized)) return undefined
  const url = new URL(normalized)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (url.username || url.password || url.search || url.hash) return undefined
  return normalized
}

export function decodePairingCode(value: string) {
  const result = Schema.decodeUnknownOption(pairing)(value)
  if (Option.isNone(result)) return undefined
  const urls = [...new Set(result.value.urls.map(serverAddress).filter((url) => url !== undefined))]
  if (!urls.length) return undefined
  return { urls, password: result.value.password }
}

export function isMixedContent(page: string, address: string) {
  if (new URL(page).protocol !== "https:") return false
  const normalized = serverAddress(address)
  if (!normalized) return false
  const url = new URL(normalized)
  if (url.protocol !== "http:") return false
  // Secure Contexts treat loopback HTTP origins as potentially trustworthy.
  const host = url.hostname.replace(/\.$/, "")
  return !(host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(?:\.\d+){3}$/.test(host))
}
