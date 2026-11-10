// «Share…» (#817): what the share dialog shows and sends, from the session as the window holds
// it. Pure — the dialog renders and calls the machine's service (`buff.share`, #816).

import { BuffShare } from "@opencode/schema/buff-share"

export type { MessagePreview } from "@opencode/schema/buff-share"
export type ExpiryPreset = BuffShare.ExpiryPreset
export const previews = BuffShare.previews
export const defaultTitle = BuffShare.defaultTitle
export const expiresAtFor = BuffShare.expiresAtFor

/** The form's state → what the service takes. */
export function createInput(form: {
  session: string
  mode: "all" | "some"
  selected: ReadonlySet<string>
  title: string
  pass: string
  expiry: ExpiryPreset
  tools: boolean
  live: boolean
  nowMs: number
}): BuffShare.CreateInput | { error: "title" | "selection" } {
  const title = form.title.trim()
  if (!title) return { error: "title" }
  if (form.mode === "some" && form.selected.size === 0) return { error: "selection" }
  return {
    session: form.session,
    ...(form.mode === "some" ? { messages: [...form.selected] } : {}),
    title,
    ...(form.pass ? { pass: form.pass } : {}),
    expiresAt: expiresAtFor(form.expiry, form.nowMs),
    tools: form.tools,
    live: form.live,
  }
}
