import { Option, Schema } from "effect"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"
import { normalizeServerUrl } from "@/runtime/server/registry"

const pairing = Schema.fromJsonString(
  Schema.Struct({
    urls: Schema.Array(Schema.String),
    // Код сопряжения новых выпусков несёт имя Buff, прежних — `opencode`.
    username: Schema.Literals(BuffServerAuth.USERNAMES),
    password: Schema.String,
  }),
)

export function serverAddress(value: string) {
  if (value.includes("://") && !/^https?:\/\//.test(value.trim())) return
  const normalized = normalizeServerUrl(value)
  if (!normalized || !URL.canParse(normalized)) return
  const url = new URL(normalized)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (url.username || url.password || url.search || url.hash) return
  return normalized
}

export function decodePairingCode(value: string) {
  const result = Schema.decodeUnknownOption(pairing)(value)
  if (Option.isNone(result)) return
  const urls = [...new Set(result.value.urls.map(serverAddress).filter((url) => url !== undefined))]
  if (!urls.length) return
  return { urls, password: result.value.password }
}
