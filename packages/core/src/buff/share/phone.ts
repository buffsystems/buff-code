// Buff (#816/#821): команды телефона `shares.*` — те же действия со ссылками, что в окне и консоли,
// в форме команд конверта. Телефон — владелец машины; права не сужаются, вход проверяется.
import { RefusalError, type Reply } from "@buff/mobile-protocol"
import { BuffLocale } from "../locale.js"
import type { CreateInput, ShareLinks, UpdateInput } from "./links.js"

export async function phoneCommand(links: ShareLinks, op: string, args: unknown): Promise<Reply> {
  const a = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  const id = () => {
    if (typeof a.id !== "string" || !a.id) throw new RefusalError(BuffLocale.t("The link is not found"))
    return a.id
  }
  switch (op) {
    case "shares.list":
      return { ok: true, links: await links.list() }
    case "shares.create":
      return { ok: true, link: await links.create(a as unknown as CreateInput) }
    case "shares.update": {
      const { id: _id, ...patch } = a
      return { ok: true, link: await links.update(id(), patch as UpdateInput) }
    }
    case "shares.remove":
      await links.remove(id())
      return { ok: true }
    default:
      throw new RefusalError(`not available from the phone: ${op}`)
  }
}
