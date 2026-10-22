// Choosing a web-search provider when an agent asks (#584), ported from the Solid request model
// (session/requests/websearch.ts): the answer to a generic "may I search" form either allows any
// provider, disables search, or picks one — which takes a second, provider-specific form.

import type { FormInfo, FormStringField, OpenCodeEvent, SessionFormReplyInput } from "@opencode/client/promise"

export function webSearchProviderField(form: FormInfo) {
  return form.fields.find(
    (field): field is FormStringField => field.type === "string" && field.key === "provider" && !!field.options,
  )
}

export async function replyWebSearch(input: {
  form: FormInfo
  selection: string | false
  signal: AbortSignal
  reply: (input: SessionFormReplyInput) => Promise<unknown>
  listen: (handler: (event: OpenCodeEvent) => void) => () => void
}) {
  if (input.signal.aborted) return
  const target = { sessionID: input.form.sessionID, formID: input.form.id }
  if (webSearchProviderField(input.form)) {
    if (input.selection === false) return
    return input.reply({ ...target, answer: { provider: input.selection } })
  }
  if (input.selection === false || input.selection === "random")
    return input.reply({ ...target, answer: { choice: input.selection === false ? "disable" : "allow" } })

  const next = Promise.withResolvers<FormInfo | undefined>()
  const stop = input.listen((event) => {
    if (event.type === "form.created") {
      const form = event.data.form
      if (
        form.sessionID !== input.form.sessionID ||
        form.id === input.form.id ||
        form.metadata?.kind !== "websearch.provider" ||
        !webSearchProviderField(form)
      )
        return
      next.resolve(form)
    }
    if (event.type === "form.cancelled" && event.data.id === input.form.id) next.resolve(undefined)
    if (event.type === "form.replied" && event.data.id === input.form.id && event.data.answer.choice !== "choose")
      next.resolve(undefined)
  })
  const cancel = () => next.resolve(undefined)
  input.signal.addEventListener("abort", cancel, { once: true })
  return Promise.all([input.reply({ ...target, answer: { choice: "choose" } }), next.promise])
    .then(([, form]) => {
      if (!form || input.signal.aborted) return
      const field = webSearchProviderField(form)
      if (!field?.options?.some((option) => option.value === input.selection)) return
      return input.reply({ sessionID: form.sessionID, formID: form.id, answer: { provider: input.selection } })
    })
    .finally(() => {
      stop()
      input.signal.removeEventListener("abort", cancel)
    })
}
