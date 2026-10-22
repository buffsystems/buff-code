// Home's session search (#584): a query over every retained record by title and project, a
// session ID looked up exactly, arrow keys through the results, mod+F to focus.

import { looksLikeSessionID } from "@opencode/app/react-reuse/session-id-search"
import { sessionLabel } from "@opencode/app/react-reuse/session-title"
import { useEffect, useRef, useState } from "react"
import { useCommandRegistration } from "../commands/provider"
import { useI18n } from "../i18n/provider"
import { homeSearchKey, moveSearchKey, searchHomeRecords, type HomeSessionRecord } from "./model"
import type { OpenOptions } from "./sessions"

export type HomeSearch = ReturnType<typeof useHomeSearch>

export function useHomeSearch(input: {
  records: HomeSessionRecord[]
  loading: boolean
  placeholder: string
  lookup: (sessionID: string) => Promise<HomeSessionRecord | undefined>
  open: (record: HomeSessionRecord, options?: OpenOptions) => void
}) {
  const i18n = useI18n()
  const [state, setState] = useState({
    query: "",
    focused: false,
    highlighted: "",
    exact: undefined as HomeSessionRecord | undefined,
    lookingUp: false,
  })
  const lookups = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const results = searchHomeRecords(
    input.records,
    state.query,
    (record) => sessionLabel(record.session, i18n.buff.t),
    state.exact,
  )
  const keys = results.map(homeSearchKey)
  const active = keys.includes(state.highlighted) ? state.highlighted : (keys[0] ?? "")
  const open = state.focused && state.query.trim().length > 0

  const close = () => {
    lookups.current++
    setState((current) => ({ ...current, query: "", focused: false, exact: undefined, lookingUp: false }))
  }
  const focus = () => {
    inputRef.current?.focus()
    setState((current) => ({ ...current, focused: true }))
  }
  const select = (record: HomeSessionRecord, options?: OpenOptions) => {
    input.open(record, options)
    if (!options?.background) close()
  }

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      close()
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [open])
  useEffect(() => () => void lookups.current++, [])

  useCommandRegistration("home.search", () => [
    { id: "home.sessions.search.focus", title: input.placeholder, keybind: "mod+f", hidden: true, onSelect: focus },
  ])

  return {
    query: state.query,
    placeholder: input.placeholder,
    open,
    loading: input.loading || state.lookingUp,
    results,
    active,
    rootRef,
    inputRef,
    listRef,
    focus,
    close,
    input(value: string) {
      const current = ++lookups.current
      const sessionID = value.trim()
      const id = looksLikeSessionID(sessionID)
      setState((previous) => ({ ...previous, query: value, highlighted: "", exact: undefined, lookingUp: id }))
      if (!id) return
      void input.lookup(sessionID).then(
        (record) =>
          current === lookups.current && setState((previous) => ({ ...previous, exact: record, lookingUp: false })),
        () => current === lookups.current && setState((previous) => ({ ...previous, lookingUp: false })),
      )
    },
    highlight: (record: HomeSessionRecord) =>
      setState((current) => ({ ...current, highlighted: homeSearchKey(record) })),
    move(delta: number) {
      const next = moveSearchKey(keys, active, delta)
      setState((current) => ({ ...current, highlighted: next }))
      listRef.current
        ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    },
    select,
    selectActive() {
      const record = results.find((item) => homeSearchKey(item) === active)
      if (record) select(record)
    },
  }
}
