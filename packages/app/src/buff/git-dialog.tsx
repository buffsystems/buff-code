import { filesMayHaveChanged } from "./files-changed"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { BuffGit } from "@opencode/schema/buff-git"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { TextField } from "@opencode/ui/text-field"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"
import { Choice, Problem } from "./settings-kit"
import "./git-dialog.css"

/**
 * Git в окне (#454): кнопка ветки под полем ввода и окно с тремя разделами — изменения (коммит
 * и отправка), ветки (перейти, создать), история (граф коммитов). Команды выполняет ядро обычным
 * git в каталоге сессии; что откажет git — показывается словами.
 */

const PAGE = 100
const TABS = [
  { value: "changes", label: "Changes" },
  { value: "branches", label: "Branches" },
  { value: "history", label: "History" },
] as const
type Tab = (typeof TABS)[number]["value"]

type Controller = ReturnType<typeof createGit>

function createGit() {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const params = useParams<{ id?: string }>()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffGit.Rpc)
  const at = () => ({ location: { directory: location().directory } })
  // Каталог не под git — состояния нет, и кнопка ветки не показывается.
  const [state, { mutate, refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? location().directory : undefined),
    () => rpc.state(undefined, at()).catch(() => undefined),
  )
  onMount(() => {
    const stop = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 400)
    }
    const unlisten = location().event.listen((event) => {
      if (filesMayHaveChanged(event.type) || event.type === "vcs.branch.updated") later()
    })
    onCleanup(() => {
      stop.abort()
      clearTimeout(timer)
      unlisten()
    })
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) later()
    })().catch(() => undefined)
  })
  /** Выполнить запись; строка — почему не вышло. */
  const run = (action: Promise<BuffGit.State>) =>
    action.then(
      (next) => {
        mutate(next)
        return undefined
      },
      (error: unknown) => formatServerError(error, undefined, t("Git refused.")),
    )
  return {
    state: () => state.latest,
    refresh: () => void refetch(),
    branches: () => rpc.branches(undefined, at()),
    switch: (branch: string, create?: boolean) => run(rpc.switch({ branch, ...(create ? { create } : {}) }, at())),
    commit: (message: string, files: string[]) => run(rpc.commit({ message, files }, at())),
    push: () => run(rpc.push(undefined, at())),
    message: (files: string[]) =>
      rpc.message({ files, ...(params.id ? { sessionID: params.id } : {}) }, at()).then((result) => result.message),
    log: (skip: number) => rpc.log({ skip, count: PAGE }, at()),
  }
}

function Changes(props: { git: Controller }) {
  const { t } = useBuffText()
  const state = () => props.git.state()
  const [form, setForm] = createStore({ message: "", excluded: {} as Record<string, boolean> })
  const [problem, setProblem] = createSignal<string>()
  const [busy, setBusy] = createSignal<"commit" | "push" | "message">()
  const selected = () =>
    (state()?.changes ?? []).filter((change) => !form.excluded[change.file]).map((change) => change.file)

  const commit = async (thenPush: boolean) => {
    const invalid = BuffGit.commitProblem({ message: form.message, files: selected() }, t)
    if (invalid) return setProblem(invalid)
    setBusy("commit")
    let refusal = await props.git.commit(form.message, selected())
    if (!refusal) {
      setForm("message", "")
      if (thenPush) {
        setBusy("push")
        refusal = await props.git.push()
      }
    }
    setProblem(refusal)
    setBusy(undefined)
  }
  const push = async () => {
    setBusy("push")
    setProblem(await props.git.push())
    setBusy(undefined)
  }
  const compose = async () => {
    setBusy("message")
    await props.git.message(selected()).then(
      (message) => {
        setForm("message", message)
        setProblem(undefined)
      },
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not compose the message."))),
    )
    setBusy(undefined)
  }

  return (
    <div class="buff-git-pane" data-component="buff-git-changes">
      <Show
        when={state()?.changes.length}
        fallback={<span class="buff-git-note">{t("The working copy is clean — nothing to commit.")}</span>}
      >
        <div class="buff-git-files">
          <For each={state()?.changes}>
            {(change) => (
              <label class="buff-git-file" data-status={change.status}>
                <input
                  type="checkbox"
                  checked={!form.excluded[change.file]}
                  onChange={(event) => setForm("excluded", change.file, !event.currentTarget.checked)}
                />
                <span class="min-w-0 flex-1 truncate font-mono">{change.file}</span>
                <span class="buff-git-status">{BuffGit.changeLabel(change, t)}</span>
              </label>
            )}
          </For>
        </div>
        <TextField
          multiline
          label={t("Commit message")}
          class="buff-kit-area"
          placeholder={t("fix: what changed and why")}
          value={form.message}
          onChange={(value) => {
            setForm("message", value)
            setProblem(undefined)
          }}
        />
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            variant="ghost"
            data-action="buff-git-compose"
            disabled={!!busy()}
            onClick={() => void compose()}
          >
            {busy() === "message" ? t("Composing…") : t("Compose the message")}
          </Button>
          <div class="flex-1" />
          <Button
            size="small"
            variant="neutral"
            data-action="buff-git-commit-push"
            disabled={!!busy()}
            onClick={() => void commit(true)}
          >
            {t("Commit and push")}
          </Button>
          <Button
            size="small"
            variant="contrast"
            data-action="buff-git-commit"
            disabled={!!busy()}
            onClick={() => void commit(false)}
          >
            {busy() === "commit" ? t("Committing…") : t("Commit")}
          </Button>
        </div>
      </Show>
      <Problem text={problem()} />
      <Show when={state()}>
        {(current) => (
          <div class="buff-git-sync">
            <span class="buff-git-note">
              {current().branch ?? t("HEAD is not on a branch")} · {BuffGit.syncLabel(current(), t)}
            </span>
            <Show when={current().branch && (current().ahead > 0 || !current().upstream)}>
              <Button
                size="small"
                variant="neutral"
                data-action="buff-git-push"
                disabled={!!busy()}
                onClick={() => void push()}
              >
                {busy() === "push" ? t("Pushing…") : t("Push")}
              </Button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

function Branches(props: { git: Controller }) {
  const { t } = useBuffText()
  const [list, { refetch }] = createResource(() => props.git.branches().catch(() => [] as string[]))
  const [name, setName] = createSignal("")
  const [problem, setProblem] = createSignal<string>()
  const current = () => props.git.state()?.branch
  const dirty = () => props.git.state()?.changes.length ?? 0
  const go = async (branch: string, create?: boolean) => {
    if (create) {
      const invalid = BuffGit.branchProblem(branch, list.latest ?? [], t)
      if (invalid) return setProblem(invalid)
    }
    const refusal = await props.git.switch(branch, create)
    setProblem(refusal)
    if (!refusal) {
      setName("")
      void refetch()
    }
  }
  return (
    <div class="buff-git-pane" data-component="buff-git-branches">
      <Show when={dirty() > 0}>
        <div class="buff-git-warning" data-slot="buff-git-dirty">
          {t(
            "There are uncommitted changes ({count}). On switching they stay in the working copy and end up in the new branch; if they get in the way, git refuses — then commit them first.",
            { count: dirty() },
          )}
        </div>
      </Show>
      <div class="buff-git-files">
        <For each={list.latest}>
          {(branch) => (
            <div class="buff-git-file" data-current={branch === current()}>
              <span class="min-w-0 flex-1 truncate font-mono">{branch}</span>
              <Show when={branch !== current()} fallback={<span class="buff-git-status">{t("current branch")}</span>}>
                <Button size="small" variant="ghost" data-action="buff-git-switch" onClick={() => void go(branch)}>
                  {t("Switch")}
                </Button>
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="flex items-end gap-2">
        <div class="min-w-0 flex-1">
          <TextField
            label={t("New branch from the current state")}
            placeholder="feature/login"
            value={name()}
            onChange={(value) => {
              setName(value)
              setProblem(undefined)
            }}
          />
        </div>
        <Button
          size="small"
          variant="contrast"
          data-action="buff-git-create"
          onClick={() => void go(name().trim(), true)}
        >
          {t("Create and switch")}
        </Button>
      </div>
      <Problem text={problem()} />
    </div>
  )
}

const LANE = 14
const ROW = 28
// Цвета дорожек — из темы Buff (#471), в обеих темах.
const COLORS = [
  "var(--v2-icon-icon-accent)",
  "var(--v2-green-600)",
  "var(--v2-yellow-600)",
  "var(--v2-red-600)",
  "var(--v2-purple-600)",
  "var(--v2-cyan-600)",
]
const color = (lane: number) => COLORS[lane % COLORS.length]
const laneX = (lane: number) => LANE / 2 + lane * LANE
const date = (time: number, locale: string) =>
  new Date(time).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", { day: "2-digit", month: "2-digit", year: "numeric" })

function History(props: { git: Controller }) {
  const { locale, t } = useBuffText()
  const [commits, setCommits] = createSignal<BuffGit.Commit[]>([])
  const [more, setMore] = createSignal(true)
  const [problem, setProblem] = createSignal<string>()
  const load = () =>
    props.git.log(commits().length).then(
      (page) => {
        setCommits([...commits(), ...page])
        setMore(page.length === PAGE)
      },
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not read the history."))),
    )
  onMount(() => void load())
  const rows = createMemo(() => BuffGit.graph(commits()))
  const width = createMemo(
    () => Math.max(1, ...rows().map((row) => Math.max(row.columns, ...row.links.map((link) => link.to + 1)))) * LANE,
  )

  return (
    <div class="buff-git-pane" data-component="buff-git-history">
      <Show when={rows().length} fallback={<span class="buff-git-note">{problem() ?? t("No commits yet.")}</span>}>
        <div class="buff-git-history">
          <For each={rows()}>
            {(row, index) => (
              <div class="buff-git-commit" data-hash={row.commit.hash}>
                <svg width={width()} height={ROW} class="shrink-0" aria-hidden="true">
                  {/* Линии сверху: что пришло из предыдущей строки. */}
                  <For each={index() > 0 ? rows()[index() - 1].links : []}>
                    {(link) => (
                      <line
                        x1={laneX(link.to)}
                        y1={0}
                        x2={laneX(link.to)}
                        y2={ROW / 2}
                        style={{ stroke: color(link.to) }}
                        stroke-width="2"
                      />
                    )}
                  </For>
                  <For each={row.links}>
                    {(link) => (
                      <path
                        d={`M ${laneX(link.from)} ${ROW / 2} C ${laneX(link.from)} ${ROW}, ${laneX(link.to)} ${ROW / 2}, ${laneX(link.to)} ${ROW}`}
                        fill="none"
                        style={{ stroke: color(link.to) }}
                        stroke-width="2"
                      />
                    )}
                  </For>
                  <circle cx={laneX(row.column)} cy={ROW / 2} r="4" style={{ fill: color(row.column) }} />
                </svg>
                <div class="buff-git-commit-text">
                  <span class="truncate">
                    <For each={row.commit.refs}>{(ref) => <span class="buff-git-ref">{ref}</span>}</For>
                    {row.commit.subject}
                  </span>
                  <span class="buff-git-status">
                    {row.commit.hash.slice(0, 7)} · {row.commit.author} · {date(row.commit.time, locale())}
                  </span>
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={more()}>
          <Button size="small" variant="ghost" data-action="buff-git-more" onClick={() => void load()}>
            {t("Show more")}
          </Button>
        </Show>
      </Show>
    </div>
  )
}

function GitDialog(props: { git: Controller; tab: Tab }) {
  const { t } = useBuffText()
  const [tab, setTab] = createSignal<Tab>(props.tab)
  // Пока окно открыто, состояние сверяется с диском: git меняют и из терминала, и сам агент.
  onMount(() => {
    const timer = setInterval(props.git.refresh, 3000)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <Dialog size="large" containerClass="buff-dialog-fit">
      <DialogHeader>
        <DialogTitle>Git · {props.git.state()?.branch ?? t("HEAD is not on a branch")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-git" data-component="buff-git">
          <Choice
            value={tab()}
            options={TABS.map((item) => ({ ...item, label: t(item.label) }))}
            onPick={setTab}
            appearance="tabs"
          />
          <Show when={tab() === "changes"}>
            <Changes git={props.git} />
          </Show>
          <Show when={tab() === "branches"}>
            <Branches git={props.git} />
          </Show>
          <Show when={tab() === "history"}>
            <History git={props.git} />
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/** Кнопка ветки под полем ввода: ветка, сколько файлов изменено, сколько коммитов не отправлено. */
export function BuffGitChip() {
  const dialog = useDialog()
  const { t } = useBuffText()
  const git = createGit()
  return (
    <Show when={git.state()}>
      {(state) => (
        <button
          type="button"
          class="buff-git-chip"
          data-component="buff-git-chip"
          title={`Git: ${BuffGit.syncLabel(state(), t)}`}
          onClick={() => {
            git.refresh()
            void dialog.show(() => <GitDialog git={git} tab="changes" />)
          }}
        >
          <span>⎇ {state().branch ?? "HEAD"}</span>
          <Show when={state().changes.length}>
            <span class="buff-git-count" data-slot="changes">
              ±{state().changes.length}
            </span>
          </Show>
          <Show when={state().ahead}>
            <span class="buff-git-count">↑{state().ahead}</span>
          </Show>
          <Show when={state().behind}>
            <span class="buff-git-count">↓{state().behind}</span>
          </Show>
        </button>
      )}
    </Show>
  )
}
