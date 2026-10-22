import { createMemo, createResource, createSignal, For, Show, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { BuffSessionMarks as Marks } from "@opencode/schema/buff-session-marks"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Menu } from "@opencode/ui/menu"
import { TextField } from "@opencode/ui/text-field"
import { loadHomeSessionIndex, mergeHomeSessionIndex } from "@/home/sessions/index"
import { formatServerError } from "@/runtime/server/errors"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { sessionFormRequest, sessionPermissionRequest } from "@/session/requests/session-request-tree"
import { sessionLabel } from "@/session/title"
import { useSettings } from "@/settings/model"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { useBuffText } from "./i18n"
import { createSessionMarks } from "./session-marks"
import { BuffSearchResult, createSessionSearch } from "./session-search"
import { Choice, FormBody, Problem } from "./settings-kit"
import "./session-sidebar.css"

/**
 * Список всех сессий рядом с работой (#452) — в вертикальной колонке, под открытыми вкладками.
 * У каждой сессии состояние словом: ждёт разрешения, ждёт ответа, выполняется, ошибка, не
 * прочитано. Сессию можно закрепить, положить в группу и убрать в архив — и вернуть из него.
 * Отметки хранит ядро: они одни на окно и консоль.
 */

const COLOR_LABEL: Record<Marks.Color, string> = {
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  red: "Red",
  purple: "Purple",
  gray: "Gray",
}
const folder = (session: SessionInfo) => session.location.directory.split("/").filter(Boolean).pop() ?? ""

type Controller = ReturnType<typeof createController>

function createController(server: () => ServerConnection.Key | undefined) {
  const global = useGlobal()
  const settings = useSettings()
  const tabs = useTabs()
  const connection = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === server()))
  const ctx = useServerCtx(connection)
  const connected = () => ctx()?.sdk.connection.status() === "connected"
  const { t } = useBuffText()

  const [index, { refetch: refetchIndex }] = createResource(
    () => (connected() ? server() : undefined),
    () => {
      const sdk = ctx()!.sdk
      return loadHomeSessionIndex((input, options) => sdk.api.session.list(input, options)).catch(
        () => [] as SessionInfo[],
      )
    },
    { initialValue: [] },
  )
  const marks = createSessionMarks(ctx)

  /** Сессии верхнего уровня: загруженный список вместе с тем, что окно узнало по ходу работы. */
  const sessions = createMemo(() => {
    const data = ctx()?.data
    return data ? mergeHomeSessionIndex(index.latest ?? [], data.session.list()) : []
  })
  const rows = createMemo(() =>
    sessions().map((session) => ({
      id: session.id,
      title: sessionLabel(session, t),
      updated: session.time.updated,
      session,
    })),
  )

  /** Состояние сессии — вместе с её субагентами: запрос субагента ждёт ответа в основной. */
  const status = (sessionID: string) => {
    const current = ctx()
    if (!current) return undefined
    const data = current.data
    const family = [...new Set([sessionID, ...data.session.family(sessionID)])].flatMap((id) => {
      const info = data.session.get(id)
      return info ? [info] : []
    })
    return Marks.status({
      permission:
        !settings.permissions.autoApprove() &&
        !!sessionPermissionRequest(family, data.session.permission.list, sessionID),
      question: !!sessionFormRequest(family, data.session.form.list, sessionID),
      running: family.some((item) => data.session.status(item.id) === "running"),
      failed: current.notification.session.unseenHasError(sessionID),
      unread: current.notification.session.unseenCount(sessionID) > 0,
    })
  }

  return {
    marks: marks.state,
    rows,
    status,
    change: marks.change,
    refresh: () => void refetchIndex(),
    open: (session: SessionInfo) => {
      const key = server()
      const current = ctx()
      if (!key || !current) return
      void startTransition(() => {
        tabs.select(tabs.addSessionTab({ server: key, sessionId: session.id }))
        current.data.session.remember(session)
        current.projects.open(session.location.directory)
      })
    },
    rename: (session: SessionInfo, title: string) =>
      ctx()
        ?.sdk.api.session.update({ sessionID: session.id, title })
        .then(
          () => ctx()?.data.session.remember({ ...session, title }),
          (error: unknown) =>
            showToast({
              title: t("Sessions"),
              description: formatServerError(error, undefined, t("Could not rename.")),
            }),
        ),
  }
}

/** Окно с одним полем: имя сессии или группы (у группы ещё цвет). */
function NameDialog(props: {
  title: string
  label: string
  name: string
  color?: Marks.Color
  onSave: (name: string, color: Marks.Color) => void
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const colors = () => Marks.COLORS.map((value) => ({ value, label: t(COLOR_LABEL[value]) }))
  const [form, setForm] = createStore({ name: props.name, color: props.color ?? ("blue" as Marks.Color) })
  const [problem, setProblem] = createSignal<string>()
  const save = () => {
    if (!form.name.trim()) return setProblem(t("{field}: the field cannot be empty.", { field: props.label }))
    props.onSave(form.name.trim(), form.color)
    dialog.close()
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-session-name">
          <TextField
            label={props.label}
            value={form.name}
            onChange={(value) => {
              setForm("name", value)
              setProblem(undefined)
            }}
          />
          <Show when={props.color !== undefined}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-weak">{t("Color")}</span>
              <Choice value={form.color} options={colors()} onPick={(value) => setForm("color", value)} />
            </div>
          </Show>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-session-name-save" onClick={save}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Row(props: { session: SessionInfo; controller: Controller; current: boolean; archived?: boolean }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const marks = () => props.controller.marks()
  const id = () => props.session.id
  const pinned = () => marks().pinned.includes(id())
  const group = () => marks().membership[id()]
  const status = () => (props.archived ? undefined : props.controller.status(id()))
  const newGroup = () =>
    void dialog.show(() => (
      <NameDialog
        title={t("New group")}
        label={t("Name")}
        name=""
        color="blue"
        onSave={(name, color) => {
          const groupID = `g${Date.now().toString(36)}`
          void props.controller
            .change({ type: "group.save", group: { id: groupID, name, color } })
            ?.then(() => props.controller.change({ type: "group.assign", sessionID: id(), groupID }))
        }}
      />
    ))
  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        class="buff-sessions-row"
        data-component="buff-sessions-row"
        data-session={id()}
        data-current={props.current}
        data-status={status()?.kind}
        onClick={() => props.controller.open(props.session)}
      >
        <span class="buff-sessions-title">{sessionLabel(props.session, t)}</span>
        <span class="buff-sessions-meta">
          <Show when={status()} fallback={<span class="truncate">{folder(props.session)}</span>}>
            {(value) => (
              <span class="buff-sessions-status" data-kind={value().kind}>
                {t(value().label)}
              </span>
            )}
          </Show>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show
            when={!props.archived}
            fallback={
              <Menu.Item
                data-action="buff-sessions-restore"
                onSelect={() => void props.controller.change({ type: "archive", sessionID: id(), on: false })}
              >
                {t("Restore from archive")}
              </Menu.Item>
            }
          >
            <Menu.Item
              data-action="buff-sessions-pin"
              onSelect={() => void props.controller.change({ type: "pin", sessionID: id(), on: !pinned() })}
            >
              {pinned() ? t("Unpin") : t("Pin")}
            </Menu.Item>
            <Menu.Item
              data-action="buff-sessions-rename"
              onSelect={() =>
                void dialog.show(() => (
                  <NameDialog
                    title={t("Rename session")}
                    label={t("Name")}
                    name={sessionLabel(props.session, t)}
                    onSave={(name) => void props.controller.rename(props.session, name)}
                  />
                ))
              }
            >
              {t("Rename")}
            </Menu.Item>
            <Menu.Separator />
            <For each={marks().groups.filter((item) => item.id !== group())}>
              {(item) => (
                <Menu.Item
                  onSelect={() =>
                    void props.controller.change({ type: "group.assign", sessionID: id(), groupID: item.id })
                  }
                >
                  {t("To group «{name}»", { name: item.name })}
                </Menu.Item>
              )}
            </For>
            <Menu.Item data-action="buff-sessions-new-group" onSelect={newGroup}>
              {t("To a new group…")}
            </Menu.Item>
            <Show when={group()}>
              <Menu.Item onSelect={() => void props.controller.change({ type: "group.assign", sessionID: id() })}>
                {t("Remove from group")}
              </Menu.Item>
            </Show>
            <Menu.Separator />
            <Menu.Item
              data-action="buff-sessions-archive"
              onSelect={() => void props.controller.change({ type: "archive", sessionID: id(), on: true })}
            >
              {t("Archive")}
            </Menu.Item>
          </Show>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

function GroupTitle(props: { section: Marks.Section<unknown>; controller: Controller }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  return (
    <Show when={props.section.group} fallback={<span class="buff-sessions-heading">{t(props.section.title)}</span>}>
      {(group) => (
        <Menu.Context modal={false}>
          <Menu.Context.Trigger as="span" class="buff-sessions-heading" data-component="buff-sessions-group">
            <span class="buff-sessions-dot" data-color={group().color} />
            {group().name}
          </Menu.Context.Trigger>
          <Menu.Context.Portal>
            <Menu.Context.Content>
              <Menu.Item
                onSelect={() =>
                  void dialog.show(() => (
                    <NameDialog
                      title={t("Group")}
                      label={t("Name")}
                      name={group().name}
                      color={group().color}
                      onSave={(name, color) =>
                        void props.controller.change({ type: "group.save", group: { id: group().id, name, color } })
                      }
                    />
                  ))
                }
              >
                {t("Edit group")}
              </Menu.Item>
              <Menu.Item onSelect={() => void props.controller.change({ type: "group.remove", groupID: group().id })}>
                {t("Delete group — sessions stay")}
              </Menu.Item>
            </Menu.Context.Content>
          </Menu.Context.Portal>
        </Menu.Context>
      )}
    </Show>
  )
}

export function BuffSessionSidebar(props: { server: ServerConnection.Key | undefined; currentSessionID?: string }) {
  const controller = createController(() => props.server)
  const { t } = useBuffText()
  const [query, setQuery] = createSignal("")
  const [archiveOpen, setArchiveOpen] = createSignal(false)
  const sections = createMemo(() => Marks.sections(controller.rows(), controller.marks(), Date.now(), query()))
  const archived = createMemo(() => Marks.archive(controller.rows(), controller.marks()))
  // #453: тот же запрос ищется и в тексте переписки.
  const search = createSessionSearch(() => props.server, query)

  return (
    <div class="buff-sessions" data-component="buff-sessions">
      <div class="buff-sessions-top">
        <span class="buff-sessions-heading">{t("All sessions")}</span>
        <input
          class="buff-sessions-search"
          placeholder={t("Search by title")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onFocus={controller.refresh}
        />
      </div>
      <div class="buff-sessions-list">
        <For each={sections()}>
          {(section) => (
            <div class="buff-sessions-section" data-section={section.key}>
              <GroupTitle section={section} controller={controller} />
              <Show
                when={section.items.length}
                fallback={<span class="buff-sessions-empty">{t("Empty — add a session from its menu.")}</span>}
              >
                <For each={section.items}>
                  {(item) => (
                    <Row session={item.session} controller={controller} current={item.id === props.currentSessionID} />
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
        <Show when={!sections().length}>
          <span class="buff-sessions-empty">{query() ? t("Nothing found by title.") : t("No sessions yet.")}</span>
        </Show>
        <Show when={search.results().length}>
          <div class="buff-sessions-section" data-section="content">
            <span class="buff-sessions-heading">{t("In conversations")}</span>
            <For each={search.results()}>
              {(result) => <BuffSearchResult result={result} onOpen={() => search.open(result)} />}
            </For>
          </div>
        </Show>
        <Show when={archived().length}>
          <div class="buff-sessions-section" data-section="archive">
            <button
              type="button"
              class="buff-sessions-heading"
              data-action="buff-sessions-archive-toggle"
              onClick={() => setArchiveOpen(!archiveOpen())}
            >
              {archiveOpen() ? "▾" : "▸"} {t("Archive · {count}", { count: archived().length })}
            </button>
            <Show when={archiveOpen()}>
              <For each={archived()}>
                {(item) => <Row session={item.session} controller={controller} current={false} archived />}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
