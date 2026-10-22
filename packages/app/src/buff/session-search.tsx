import {
  createEffect,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  startTransition,
} from "solid-js"
import { BuffSearch } from "@opencode/schema/buff-search"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { formatServerError } from "@/runtime/server/errors"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"
import { useBuffText } from "./i18n"
import "./session-search.css"

/**
 * Поиск по тексту переписки (#453): сессию находят не только по названию, но и по тому, что в
 * ней писали. В выдаче — сессия, фрагмент с подсвеченным совпадением и сколько совпадений ещё.
 * Открывается отовсюду командой; те же строки показывает поиск в колонке сессий.
 */

/** Поиск по мере набора: запрос уходит, когда человек перестал печатать. */
export function createSessionSearch(server: () => ServerConnection.Key | undefined, query: () => string) {
  const global = useGlobal()
  const tabs = useTabs()
  const connection = () => global.servers.list().find((item) => ServerConnection.key(item) === server())
  const ctx = useServerCtx(connection)
  const [settled, setSettled] = createSignal("")
  createEffect(
    on(query, (value) => {
      const timer = setTimeout(() => setSettled(value.trim()), 250)
      onCleanup(() => clearTimeout(timer))
    }),
  )
  const [problem, setProblem] = createSignal<string>()
  const [results] = createResource(
    () => (BuffSearch.problem(settled()) ? undefined : settled()),
    (text) =>
      ctx()
        ?.sdk.api.rpc(BuffSearch.Rpc)
        .sessions({ query: text })
        .then(
          (found) => {
            setProblem(undefined)
            return found
          },
          (error: unknown) => {
            setProblem(formatServerError(error, undefined, "Search failed."))
            return [] as BuffSearch.Result[]
          },
        ) ?? [],
  )
  return {
    /** Запрос, по которому получена выдача. */
    query: settled,
    active: () => !BuffSearch.problem(settled()),
    loading: () => results.loading,
    problem,
    results: () => (BuffSearch.problem(settled()) ? [] : (results.latest ?? [])),
    open: (result: BuffSearch.Result) => {
      const key = server()
      const current = ctx()
      if (!key || !current) return
      void startTransition(() => {
        tabs.select(tabs.addSessionTab({ server: key, sessionId: result.sessionID }))
        if (result.directory) current.projects.open(result.directory)
      })
    },
  }
}

export function BuffSearchResult(props: { result: BuffSearch.Result; onOpen: () => void }) {
  const { t, n } = useBuffText()
  return (
    <button
      type="button"
      class="buff-search-result"
      data-component="buff-search-result"
      data-session={props.result.sessionID}
      onClick={props.onOpen}
    >
      <span class="buff-search-title">{props.result.title || t("Untitled")}</span>
      <span class="buff-search-fragment">
        <span class="buff-search-role">{t(BuffSearch.ROLE[props.result.role])}:</span> {props.result.fragment.before}
        <mark>{props.result.fragment.match}</mark>
        {props.result.fragment.after}
      </span>
      <Show when={BuffSearch.moreLabel(props.result.more, n)}>
        {(more) => <span class="buff-search-more">{more()}</span>}
      </Show>
    </button>
  )
}

function SearchDialog(props: { server: ServerConnection.Key | undefined }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const [query, setQuery] = createSignal("")
  const search = createSessionSearch(() => props.server, query)
  let input: HTMLInputElement | undefined
  onMount(() => queueMicrotask(() => input?.focus()))
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{t("Search the conversations")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-search" data-component="buff-search">
          <input
            ref={input}
            class="buff-search-input"
            data-action="buff-search-input"
            placeholder={t("What you wrote or what the model answered")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <div class="buff-search-list">
            <For each={search.results()}>
              {(result) => (
                <BuffSearchResult
                  result={result}
                  onOpen={() => {
                    search.open(result)
                    dialog.close()
                  }}
                />
              )}
            </For>
            <Show when={!search.results().length}>
              <span class="buff-search-note">
                {t(
                  search.problem() ??
                    (!query().trim()
                      ? "Searches the message text in all sessions."
                      : !search.active()
                        ? (BuffSearch.problem(query()) ?? "")
                        : search.loading() || search.query() !== query().trim()
                          ? "Searching…"
                          : "Nothing found."),
                )}
              </span>
            </Show>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/** Открыть поиск по переписке. */
export function useSessionSearchDialog(server: () => ServerConnection.Key | undefined) {
  const dialog = useDialog()
  return () => void dialog.show(() => <SearchDialog server={server()} />)
}
