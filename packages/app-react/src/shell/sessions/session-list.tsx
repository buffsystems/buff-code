// Every session of the server beside the work (#584, Buff #452): pinned, groups, then by day, each
// with its state in a word — waiting for permission, for an answer, running, failed. A row's menu
// pins, renames, files into a group and archives; the archive restores. Marks are the core's.

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Field,
  Input,
} from "@buff/ui/react"
import { loadHomeSessionIndex, mergeHomeSessionIndex } from "@opencode/app/react-reuse/home-session-index"
import { sessionFormRequest, sessionPermissionRequest } from "@opencode/app/react-reuse/session-request-tree"
import { sessionLabel } from "@opencode/app/react-reuse/session-title"
import { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import type { SessionInfo } from "@opencode/client/promise"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { TranscriptSearchResult, useOpenTranscriptResult, useTranscriptSearch } from "./transcript-search"
import { useMemo, useState } from "react"
import type { DataState } from "../../core/data/state"
import { serverKey, type Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useSessionMarks } from "../../home/marks"
import { useI18n } from "../../i18n/provider"
import { useConnection, useServerData, useServers } from "../../react/core"
import { shallowEqual } from "../../react/use-store"
import { ContextMenu } from "../menu/context-menu"
import { showToast } from "../notifications/toast"
import { useShellSettings } from "../settings-context"
import { useServerByKey } from "../server-data"
import { useCurrentTab, useTabs } from "../tabs/provider"
import { tabServer } from "../tabs/tabs"

type Row = { id: string; title: string; updated: number; session: SessionInfo }

const folder = (session: SessionInfo) => session.location.directory.split("/").filter(Boolean).pop() ?? ""

/** The server the sessions column shows: the current tab's, else the first one. */
export function useSessionsServer() {
  const current = useCurrentTab()
  const first = useServers()[0]
  return useServerByKey(current?.server ?? (first ? serverKey(first) : undefined))
}

export function BuffSessionList() {
  const current = useCurrentTab()
  const server = useSessionsServer()
  if (!server) return null
  return (
    <ServerSessionList
      key={server.key}
      server={server}
      current={current?.type === "session" ? current.sessionId : undefined}
    />
  )
}

function ServerSessionList(props: { server: Server; current?: string }) {
  const i18n = useI18n()
  const connected = useConnection(props.server).status === "connected"
  const marks = useSessionMarks(props.server)
  const [query, setQuery] = useState("")
  const [archiveOpen, setArchiveOpen] = useState(false)
  const index = useQuery({
    queryKey: ["home-sessions", props.server.key],
    enabled: connected,
    queryFn: ({ signal }) =>
      loadHomeSessionIndex((input, options) => props.server.api().session.list(input, options), signal).catch(
        () => [] as SessionInfo[],
      ),
    retry: false,
    staleTime: 30_000,
  })
  const live = useServerData(props.server, (state) => state.session.info)
  const rows = useMemo(
    () =>
      mergeHomeSessionIndex(index.data ?? [], Object.values(live)).map(
        (session): Row => ({
          id: session.id,
          title: sessionLabel(session, i18n.buff.t),
          updated: session.time.updated ?? session.time.created,
          session,
        }),
      ),
    [index.data, live, i18n],
  )
  const sections = BuffSessionMarks.sections(rows, marks, Date.now(), query)
  // #453: the same query searches the conversations' text too.
  const search = useTranscriptSearch(props.server, query)
  const openResult = useOpenTranscriptResult(props.server)
  const archived = BuffSessionMarks.archive(rows, marks)
  return (
    <div data-component="buff-sessions" className="mt-4 flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-1.5 px-1">
        <span className="ui-eyebrow">{i18n.buff.t("All sessions")}</span>
        <Input
          compact
          aria-label={i18n.buff.t("Search by title")}
          placeholder={i18n.buff.t("Search by title")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onFocus={() => void index.refetch()}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
        {sections.map((section) => (
          <div key={section.key} data-section={section.key} className="flex flex-col gap-0.5">
            <SectionTitle section={section} server={props.server} />
            {section.items.length === 0 ? (
              <span className="ui-note px-1.5 text-xs">{i18n.buff.t("Empty — add a session from its menu.")}</span>
            ) : (
              section.items.map((row) => (
                <SessionRow
                  key={row.id}
                  row={row}
                  server={props.server}
                  marks={marks}
                  current={row.id === props.current}
                />
              ))
            )}
          </div>
        ))}
        {sections.length === 0 && (
          <span className="ui-note px-1.5 text-xs">
            {query ? i18n.buff.t("Nothing found by title.") : i18n.buff.t("No sessions yet.")}
          </span>
        )}
        {search.results.length > 0 && (
          <div data-section="content" className="flex flex-col gap-0.5">
            <span className="ui-eyebrow px-1.5">{i18n.buff.t("In conversations")}</span>
            {search.results.map((result) => (
              <TranscriptSearchResult
                key={`${result.sessionID}:${result.fragment.before}${result.fragment.match}`}
                result={result}
                onOpen={() => openResult(result)}
              />
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <div data-section="archive" className="flex flex-col gap-0.5">
            <button
              type="button"
              data-action="buff-sessions-archive-toggle"
              aria-expanded={archiveOpen}
              className="ui-eyebrow px-1.5 text-start"
              onClick={() => setArchiveOpen(!archiveOpen)}
            >
              {archiveOpen ? "▾" : "▸"} {i18n.buff.t("Archive · {count}", { count: archived.length })}
            </button>
            {archiveOpen &&
              archived.map((row) => (
                <SessionRow key={row.id} row={row} server={props.server} marks={marks} current={false} archived />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

function useMarkChange(server: Server) {
  const i18n = useI18n()
  const client = useQueryClient()
  return (change: BuffSessionMarks.Change) =>
    server
      .api()
      .rpc(BuffSessionMarks.Rpc)
      .change(change)
      .then(
        (next) => client.setQueryData(["session-marks", server.key], next),
        (error: unknown) =>
          showToast({
            title: i18n.buff.t("Sessions"),
            description: i18n.buff.t(error instanceof Error ? error.message : "Could not save."),
          }),
      )
}

function SessionRow(props: {
  row: Row
  server: Server
  marks: BuffSessionMarks.State
  current: boolean
  archived?: boolean
}) {
  const i18n = useI18n()
  const tabs = useTabs()
  const dialog = useDialog()
  const change = useMarkChange(props.server)
  const autoApprove = useShellSettings((settings) => settings.autoApprove)
  const id = props.row.id
  const status = useServerData(
    props.server,
    (state) => (props.archived ? undefined : rowStatus(state, id, autoApprove)),
    shallowEqual,
  )
  const pinned = props.marks.pinned.includes(id)
  const group = props.marks.membership[id]
  const open = () => {
    props.server.data.session.remember(props.row.session)
    tabs.select(tabs.addSessionTab({ server: tabServer(props.server.key), sessionId: id }))
  }
  const rename = (title: string) =>
    props.server
      .api()
      .session.update({ sessionID: id, title })
      .then(
        () => props.server.data.session.remember({ ...props.row.session, title }),
        (error: unknown) =>
          showToast({
            title: i18n.buff.t("Sessions"),
            description: error instanceof Error ? error.message : i18n.buff.t("Could not rename."),
          }),
      )
  const ask = (
    input: { title: string; name: string; color?: BuffSessionMarks.Color },
    save: (name: string, color: BuffSessionMarks.Color) => void,
  ) => dialog.show((close) => <NameDialog {...input} onClose={close} onSave={save} />)
  return (
    <ContextMenu
      content={
        props.archived ? (
          <DropdownMenuItem
            data-action="buff-sessions-restore"
            onSelect={() => void change({ type: "archive", sessionID: id, on: false })}
          >
            {i18n.buff.t("Restore from archive")}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              data-action="buff-sessions-pin"
              onSelect={() => void change({ type: "pin", sessionID: id, on: !pinned })}
            >
              {pinned ? i18n.buff.t("Unpin") : i18n.buff.t("Pin")}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-action="buff-sessions-rename"
              onSelect={() =>
                ask({ title: i18n.buff.t("Rename session"), name: props.row.title }, (name) => void rename(name))
              }
            >
              {i18n.buff.t("Rename")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {props.marks.groups
              .filter((item) => item.id !== group)
              .map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => void change({ type: "group.assign", sessionID: id, groupID: item.id })}
                >
                  {i18n.buff.t("To group «{name}»", { name: item.name })}
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem
              data-action="buff-sessions-new-group"
              onSelect={() =>
                ask({ title: i18n.buff.t("New group"), name: "", color: "blue" }, (name, color) => {
                  const groupID = `g${Date.now().toString(36)}`
                  void change({ type: "group.save", group: { id: groupID, name, color } }).then(() =>
                    change({ type: "group.assign", sessionID: id, groupID }),
                  )
                })
              }
            >
              {i18n.buff.t("To a new group…")}
            </DropdownMenuItem>
            {group && (
              <DropdownMenuItem onSelect={() => void change({ type: "group.assign", sessionID: id })}>
                {i18n.buff.t("Remove from group")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-action="buff-sessions-archive"
              onSelect={() => void change({ type: "archive", sessionID: id, on: true })}
            >
              {i18n.buff.t("Archive")}
            </DropdownMenuItem>
          </>
        )
      }
    >
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          data-component="buff-sessions-row"
          data-session={id}
          data-current={props.current}
          data-status={status?.kind}
          className="flex w-full min-w-0 flex-col items-start rounded-md px-1.5 py-1 text-start hover:bg-accent data-[current=true]:bg-accent"
          onClick={open}
        >
          <span className="w-full truncate text-[13px] leading-4">{props.row.title}</span>
          <span className="w-full truncate text-xs text-muted-foreground">
            {status ? (
              <span data-kind={status.kind} className={status.kind === "failed" ? "text-destructive" : "text-primary"}>
                {i18n.buff.t(status.label)}
              </span>
            ) : (
              folder(props.row.session)
            )}
          </span>
        </button>
      )}
    </ContextMenu>
  )
}

/** A session's state in a word; its subagents' requests count, they wait on the main session. */
function rowStatus(state: DataState, sessionID: string, autoApprove: boolean) {
  const family = [...new Set([sessionID, ...(state.session.family[sessionID] ?? [])])].flatMap((id) => {
    const info = state.session.info[id]
    return info ? [info] : []
  })
  return BuffSessionMarks.status({
    permission: !autoApprove && !!sessionPermissionRequest(family, state.session.permission, sessionID),
    question: !!sessionFormRequest(family, state.session.form, sessionID),
    running: [sessionID, ...family.map((item) => item.id)].some((id) => state.session.active[id] === "running"),
  })
}

function SectionTitle(props: { section: BuffSessionMarks.Section<Row>; server: Server }) {
  const i18n = useI18n()
  const dialog = useDialog()
  const change = useMarkChange(props.server)
  const group = props.section.group
  if (!group) return <span className="ui-eyebrow px-1.5">{i18n.buff.t(props.section.title)}</span>
  return (
    <ContextMenu
      content={
        <>
          <DropdownMenuItem
            onSelect={() =>
              dialog.show((close) => (
                <NameDialog
                  title={i18n.buff.t("Group")}
                  name={group.name}
                  color={group.color}
                  onClose={close}
                  onSave={(name, color) => void change({ type: "group.save", group: { id: group.id, name, color } })}
                />
              ))
            }
          >
            {i18n.buff.t("Edit group")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void change({ type: "group.remove", groupID: group.id })}>
            {i18n.buff.t("Delete group — sessions stay")}
          </DropdownMenuItem>
        </>
      }
    >
      {(trigger) => (
        <span {...trigger} data-component="buff-sessions-group" className="ui-eyebrow flex items-center gap-1.5 px-1.5">
          <span
            data-color={group.color}
            className="size-2 rounded-full"
            style={{ background: `var(--${group.color}, currentColor)` }}
          />
          {group.name}
        </span>
      )}
    </ContextMenu>
  )
}

const COLOR_LABEL: Record<BuffSessionMarks.Color, string> = {
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  red: "Red",
  purple: "Purple",
  gray: "Gray",
}

/** One field: a session's or a group's name (a group also has a colour). */
function NameDialog(props: {
  title: string
  name: string
  color?: BuffSessionMarks.Color
  onClose: () => void
  onSave: (name: string, color: BuffSessionMarks.Color) => void
}) {
  const i18n = useI18n()
  const [name, setName] = useState(props.name)
  const [color, setColor] = useState<BuffSessionMarks.Color>(props.color ?? "blue")
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const save = () => {
    if (!name.trim())
      return setProblem(i18n.buff.t("{field}: the field cannot be empty.", { field: i18n.buff.t("Name") }))
    props.onSave(name.trim(), color)
    props.onClose()
  }
  return (
    <Dialog
      open
      size="sm"
      title={props.title}
      onOpenChange={(open) => !open && props.onClose()}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <form
          data-component="buff-session-name"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <Field label={i18n.buff.t("Name")} error={problem}>
            <Input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value)
                setProblem(undefined)
              }}
            />
          </Field>
          {props.color !== undefined && (
            <Field label={i18n.buff.t("Color")}>
              <div role="radiogroup" className="flex flex-wrap gap-1.5">
                {BuffSessionMarks.COLORS.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    type="button"
                    role="radio"
                    aria-checked={value === color}
                    variant={value === color ? "primary" : "outline"}
                    onClick={() => setColor(value)}
                  >
                    {i18n.buff.t(COLOR_LABEL[value])}
                  </Button>
                ))}
              </div>
            </Field>
          )}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={props.onClose}>
          {i18n.buff.t("Cancel")}
        </Button>
        <Button variant="primary" data-action="buff-session-name-save" onClick={save}>
          {i18n.buff.t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
