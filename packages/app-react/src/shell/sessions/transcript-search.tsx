// Search in the conversations' text (Buff #453, ported in #584): a session is found by what was
// written in it, not only by its title. A result names the session, shows the fragment with the
// match marked and how many more matches it holds. A command opens it from anywhere; the sessions
// column shows the same results under its title search.

import { Dialog, DialogBody, Input } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffSearch } from "@opencode/schema/buff-search"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useCommandRegistration } from "../../commands/provider"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useCore } from "../../react/core"
import { useTabs } from "../tabs/provider"
import { tabServer } from "../tabs/tabs"
import "./transcript-search.css"

const DEBOUNCE = 250

/** Opening a result: its session's tab, and its project among the server's open ones. */
export function useOpenTranscriptResult(server: Server | undefined) {
  const core = useCore()
  const tabs = useTabs()
  return (result: BuffSearch.Result) => {
    if (!server) return
    tabs.select(tabs.addSessionTab({ server: tabServer(server.key), sessionId: result.sessionID }))
    if (result.directory) core.serverState.projects(core.scope(server.key)).open(result.directory)
  }
}

/** The search as you type: the request goes once typing pauses. */
export function useTranscriptSearch(server: Server | undefined, query: string) {
  const [settled, setSettled] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), DEBOUNCE)
    return () => clearTimeout(timer)
  }, [query])
  const valid = !BuffSearch.problem(settled)
  const results = useQuery({
    queryKey: ["buff-transcript-search", server?.key, settled],
    enabled: !!server && valid,
    retry: false,
    queryFn: () => (server ? server.api().rpc(BuffSearch.Rpc).sessions({ query: settled }) : []),
  })
  return {
    /** The query the results answer. */
    query: settled,
    valid,
    loading: results.isFetching,
    problem: results.error ? formatServerError(results.error, undefined, "Search failed.") : undefined,
    results: valid ? (results.data ?? []) : [],
  }
}

export function TranscriptSearchResult(props: { result: BuffSearch.Result; onOpen: () => void }) {
  const { t, n } = useI18n().buff
  const more = BuffSearch.moreLabel(props.result.more, n)
  return (
    <button
      type="button"
      className="buff-search-result"
      data-component="buff-search-result"
      data-session={props.result.sessionID}
      onClick={props.onOpen}
    >
      <span className="buff-search-title">{props.result.title || t("Untitled")}</span>
      <span className="buff-search-fragment">
        <span className="buff-search-role">{t(BuffSearch.ROLE[props.result.role])}:</span>{" "}
        {props.result.fragment.before}
        <mark>{props.result.fragment.match}</mark>
        {props.result.fragment.after}
      </span>
      {more && <span className="buff-search-more">{more}</span>}
    </button>
  )
}

// Shown from the window's dialog stack, outside the tabs: opening a result is handed in.
function TranscriptSearchDialog(props: {
  server: Server | undefined
  onOpen: (result: BuffSearch.Result) => void
  onClose: () => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const [query, setQuery] = useState("")
  const search = useTranscriptSearch(props.server, query)
  const note = (() => {
    if (search.problem) return search.problem
    if (!query.trim()) return t("Searches the message text in all sessions.")
    if (BuffSearch.problem(query)) return t(BuffSearch.problem(query) ?? "")
    if (search.loading || search.query !== query.trim()) return t("Searching…")
    return t("Nothing found.")
  })()
  return (
    <Dialog
      open
      size="lg"
      title={t("Search the conversations")}
      closeLabel={i18n.t("common.close")}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogBody>
        <div className="buff-search" data-component="buff-search">
          <Input
            autoFocus
            data-action="buff-search-input"
            aria-label={t("Search the conversations")}
            placeholder={t("What you wrote or what the model answered")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className="buff-search-list">
            {search.results.map((result) => (
              <TranscriptSearchResult
                key={`${result.sessionID}:${result.fragment.before}${result.fragment.match}`}
                result={result}
                onOpen={() => {
                  props.onOpen(result)
                  props.onClose()
                }}
              />
            ))}
            {search.results.length === 0 && <span className="buff-search-note">{note}</span>}
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/** «Search the conversations» (mod+alt+f) over the given server, from anywhere in the window. */
export function useTranscriptSearchCommand(server: Server | undefined) {
  const i18n = useI18n()
  const dialog = useDialog()
  const open = useOpenTranscriptResult(server)
  useCommandRegistration("buff-session-search", () => [
    {
      id: "buff.session.search",
      title: i18n.buff.t("Search the conversations"),
      category: i18n.t("command.category.view"),
      keybind: "mod+alt+f",
      onSelect: () =>
        void dialog.show((close) => <TranscriptSearchDialog server={server} onOpen={open} onClose={close} />),
    },
  ])
}
