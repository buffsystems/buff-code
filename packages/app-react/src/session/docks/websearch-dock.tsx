// The web-search dock (#584), ported from the Solid one: pick the provider agents search with
// (or any, or none) when a session first wants to search the web.

import { Button, SelectMenu } from "@buff/ui/react"
import type { FormInfo } from "@opencode/client/promise"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { useSession } from "../context"
import { replyWebSearch, webSearchProviderField } from "./websearch"

export function WebSearchDock(props: { request: FormInfo; onSubmit(): void }) {
  const i18n = useI18n()
  const { server } = useSession()
  const connected = useConnection(server).status === "connected"
  const sending = useRef<{ form: FormInfo; abort: AbortController } | undefined>(undefined)
  // The form being answered stays on screen until the reply settles.
  const [answering, setAnswering] = useState<FormInfo>()
  const [failed, setFailed] = useState(false)
  const [chosen, setChosen] = useState("random")
  const request = answering ?? props.request
  const specific = !!webSearchProviderField(request)
  const providers = useQuery({
    queryKey: ["websearch.providers", server.key, request.id],
    queryFn: async () => {
      const field = webSearchProviderField(request)
      if (field) return field.options ?? []
      const session = server.data.session.get(request.sessionID) ?? (await server.api().session.get({ sessionID: request.sessionID }))
      const result = await server.api().websearch.providers({ location: { directory: session.location.directory } })
      return result.data.map((provider) => ({ value: provider.id, label: provider.name }))
    },
  })
  useEffect(() => () => sending.current?.abort.abort(), [])
  const loaded = providers.data ?? []
  const selected = specific ? (loaded.some((option) => option.value === chosen) ? chosen : loaded[0]?.value) : chosen
  const options = [...(specific ? [] : [{ value: "random", label: i18n.t("session.websearch.any") }]), ...loaded]
  const busy = !!answering || !connected
  const unavailable = providers.isLoading || providers.isError || loaded.length === 0
  const status = providers.isLoading
    ? i18n.t("common.loading")
    : failed
      ? i18n.t("session.websearch.failed")
      : loaded.length === 0
        ? i18n.t("session.websearch.empty")
        : undefined

  const submit = (selection: string | false) => {
    if (busy || (selection === false && specific)) return
    props.onSubmit()
    const current = { form: props.request, abort: new AbortController() }
    sending.current = current
    setAnswering(props.request)
    setFailed(false)
    void replyWebSearch({
      form: props.request,
      selection,
      signal: current.abort.signal,
      reply: (input) => server.data.session.form.reply(input),
      listen: server.event.listen,
    })
      .catch(() => {
        if (!current.abort.signal.aborted) setFailed(true)
      })
      .finally(() => {
        if (sending.current === current) {
          sending.current = undefined
          setAnswering(undefined)
        }
      })
  }

  return (
    <section data-component="session-websearch-dock" className="dock-prompt" aria-label={i18n.t("session.websearch.title")} aria-busy={!!answering}>
      <div className="dock-prompt__body websearch">
        <div className="websearch__copy">
          <div className="dock-prompt__title">{i18n.t("session.websearch.title")}</div>
          <div className="dock-prompt__hint">{i18n.t("session.websearch.description")}</div>
        </div>
        <SelectMenu
          aria-label={i18n.t("session.websearch.provider")}
          options={options}
          value={selected}
          placeholder={i18n.t("session.websearch.provider")}
          disabled={busy || unavailable}
          onValueChange={(value) => {
            setChosen(value)
            setFailed(false)
          }}
        />
      </div>
      <div className="dock-prompt__footer">
        <div className="dock-prompt__hint" aria-live="polite">
          {providers.isError ? (
            <>
              <span>{i18n.t("session.websearch.loadFailed")}</span>
              <Button variant="ghost" size="sm" onClick={() => void providers.refetch()} disabled={busy}>
                {i18n.t("session.websearch.retry")}
              </Button>
            </>
          ) : (
            status
          )}
        </div>
        <div className="dock-prompt__actions">
          {!specific && (
            <Button variant="ghost" size="sm" onClick={() => submit(false)} disabled={busy}>
              {i18n.t("session.websearch.disable")}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => selected && submit(selected)}
            disabled={busy || unavailable || !options.some((option) => option.value === selected)}
          >
            {i18n.t("session.websearch.enable")}
          </Button>
        </div>
      </div>
    </section>
  )
}
