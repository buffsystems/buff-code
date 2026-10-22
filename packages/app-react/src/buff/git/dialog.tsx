// The Git dialog (#454), ported from the Solid window's buff/git-dialog.tsx: three sections —
// changes (commit and push), branches (switch, create), history (the commit graph). The core runs
// plain git in the session's directory; what git refuses is shown in words.

import { Badge, Button, Callout, Checkbox, Dialog, DialogBody, EmptyState, Field, Input, TabPanel, Tabs, Textarea } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffGit } from "@opencode/schema/buff-git"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { LOG_PAGE, type GitController } from "./controller"

type Tab = "changes" | "branches" | "history"

export function GitDialog(props: { git: GitController; tab?: Tab; onClose: () => void }) {
  const t = useI18n().buff.t
  const [tab, setTab] = useState<Tab>(props.tab ?? "changes")
  const state = useStore(props.git.state, (value) => value)
  // While open, the state is checked against the disk: git is changed from the terminal and by the agent.
  useEffect(() => {
    const timer = setInterval(() => void props.git.refresh(), 3000)
    return () => clearInterval(timer)
  }, [props.git])
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && props.onClose()}
      title={`Git · ${state?.branch ?? t("HEAD is not on a branch")}`}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div data-component="buff-git">
          <Tabs
            label="Git"
            value={tab}
            onValueChange={(value) => setTab(value === "branches" || value === "history" ? value : "changes")}
            items={[
              { id: "changes", label: t("Changes") },
              { id: "branches", label: t("Branches") },
              { id: "history", label: t("History") },
            ]}
          >
            <TabPanel value={tab}>
              {tab === "changes" && <Changes git={props.git} />}
              {tab === "branches" && <Branches git={props.git} />}
              {tab === "history" && <History git={props.git} />}
            </TabPanel>
          </Tabs>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function Problem(props: { text?: string }) {
  if (!props.text) return null
  return (
    <p className="ui-error" role="alert">
      {props.text}
    </p>
  )
}

function Changes(props: { git: GitController }) {
  const t = useI18n().buff.t
  const state = useStore(props.git.state, (value) => value)
  const [message, setMessage] = useState("")
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState<"commit" | "push" | "message">()
  const selected = (state?.changes ?? []).filter((change) => !excluded[change.file]).map((change) => change.file)

  const commit = async (thenPush: boolean) => {
    const invalid = BuffGit.commitProblem({ message, files: selected }, t)
    if (invalid) return setProblem(invalid)
    setBusy("commit")
    const refusal = await props.git.commit(message, selected)
    if (refusal || !thenPush) {
      if (!refusal) setMessage("")
      setProblem(refusal)
      return setBusy(undefined)
    }
    setMessage("")
    setBusy("push")
    setProblem(await props.git.push())
    setBusy(undefined)
  }
  const push = async () => {
    setBusy("push")
    setProblem(await props.git.push())
    setBusy(undefined)
  }
  const compose = async () => {
    setBusy("message")
    await props.git.message(selected).then(
      (text) => {
        setMessage(text)
        setProblem(undefined)
      },
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not compose the message."))),
    )
    setBusy(undefined)
  }

  return (
    <div className="flex flex-col gap-3" data-component="buff-git-changes">
      {!state?.changes.length ? (
        <EmptyState inline>{t("The working copy is clean — nothing to commit.")}</EmptyState>
      ) : (
        <>
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {state.changes.map((change) => (
              <div key={change.file} className="flex items-center gap-2 text-sm" data-status={change.status}>
                <Checkbox
                  checked={!excluded[change.file]}
                  aria-label={change.file}
                  onChange={(event) =>
                    setExcluded((current) => ({ ...current, [change.file]: !event.currentTarget.checked }))
                  }
                />
                <span className="min-w-0 flex-1 truncate font-mono">{change.file}</span>
                <span className="ui-hint">{BuffGit.changeLabel(change, t)}</span>
              </div>
            ))}
          </div>
          <Field label={t("Commit message")}>
            <Textarea
              rows={3}
              placeholder={t("fix: what changed and why")}
              value={message}
              onChange={(event) => {
                setMessage(event.currentTarget.value)
                setProblem(undefined)
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              data-action="buff-git-compose"
              disabled={!!busy}
              onClick={() => void compose()}
            >
              {busy === "message" ? t("Composing…") : t("Compose the message")}
            </Button>
            <span className="flex-1" />
            <Button size="sm" data-action="buff-git-commit-push" disabled={!!busy} onClick={() => void commit(true)}>
              {t("Commit and push")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              data-action="buff-git-commit"
              disabled={!!busy}
              onClick={() => void commit(false)}
            >
              {busy === "commit" ? t("Committing…") : t("Commit")}
            </Button>
          </div>
        </>
      )}
      <Problem text={problem} />
      {state && (
        <div className="flex items-center justify-between gap-2">
          <span className="ui-note">
            {state.branch ?? t("HEAD is not on a branch")} · {BuffGit.syncLabel(state, t)}
          </span>
          {state.branch && (state.ahead > 0 || !state.upstream) && (
            <Button size="sm" data-action="buff-git-push" disabled={!!busy} onClick={() => void push()}>
              {busy === "push" ? t("Pushing…") : t("Push")}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function Branches(props: { git: GitController }) {
  const t = useI18n().buff.t
  const state = useStore(props.git.state, (value) => value)
  const list = useQuery({
    queryKey: ["buff-git-branches", props.git],
    queryFn: () => props.git.branches().catch((): readonly string[] => []),
    gcTime: 0,
  })
  const [name, setName] = useState("")
  const [problem, setProblem] = useState<string>()
  const dirty = state?.changes.length ?? 0
  const go = async (branch: string, create?: boolean) => {
    const invalid = create ? BuffGit.branchProblem(branch, list.data ?? [], t) : undefined
    if (invalid) return setProblem(invalid)
    const refusal = await props.git.switch(branch, create)
    setProblem(refusal)
    if (refusal) return
    setName("")
    void list.refetch()
  }
  return (
    <div className="flex flex-col gap-3" data-component="buff-git-branches">
      {dirty > 0 && (
        <Callout tone="warn" data-slot="buff-git-dirty">
          {t(
            "There are uncommitted changes ({count}). On switching they stay in the working copy and end up in the new branch; if they get in the way, git refuses — then commit them first.",
            { count: dirty },
          )}
        </Callout>
      )}
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {list.data?.map((branch) => (
          <div key={branch} className="flex items-center gap-2 text-sm" data-current={branch === state?.branch}>
            <span className="min-w-0 flex-1 truncate font-mono">{branch}</span>
            {branch === state?.branch ? (
              <Badge size="sm">{t("current branch")}</Badge>
            ) : (
              <Button size="sm" variant="ghost" data-action="buff-git-switch" onClick={() => void go(branch)}>
                {t("Switch")}
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <Field label={t("New branch from the current state")} className="min-w-0 flex-1">
          <Input
            placeholder="feature/login"
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value)
              setProblem(undefined)
            }}
          />
        </Field>
        <Button variant="primary" data-action="buff-git-create" onClick={() => void go(name.trim(), true)}>
          {t("Create and switch")}
        </Button>
      </div>
      <Problem text={problem} />
    </div>
  )
}

const LANE = 14
const ROW = 28
// Lane colours from the design system's tokens, in both themes.
const COLORS = [
  "var(--primary)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "var(--syntax-func)",
  "var(--ansi-cyan)",
]
const color = (lane: number) => COLORS[lane % COLORS.length]
const laneX = (lane: number) => LANE / 2 + lane * LANE

function History(props: { git: GitController }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const [commits, setCommits] = useState<readonly BuffGit.Commit[]>([])
  const [more, setMore] = useState(false)
  const [problem, setProblem] = useState<string>()
  const load = (skip: number) =>
    props.git.log(skip).then(
      (page) => {
        setCommits((current) => [...current.slice(0, skip), ...page])
        setMore(page.length === LOG_PAGE)
      },
      (error: unknown) => setProblem(formatServerError(error, undefined, t("Could not read the history."))),
    )
  useEffect(() => void load(0), [props.git])
  const rows = BuffGit.graph([...commits])
  const width = Math.max(1, ...rows.map((row) => Math.max(row.columns, ...row.links.map((link) => link.to + 1)))) * LANE
  const date = (time: number) =>
    new Date(time).toLocaleDateString(i18n.locale === "ru" ? "ru-RU" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  if (!rows.length) return <EmptyState inline>{problem ?? t("No commits yet.")}</EmptyState>
  return (
    <div className="flex flex-col gap-2" data-component="buff-git-history">
      <div className="flex max-h-80 flex-col overflow-y-auto">
        {rows.map((row, index) => (
          <div key={row.commit.hash} className="flex items-center gap-2" data-hash={row.commit.hash}>
            <svg width={width} height={ROW} className="shrink-0" aria-hidden="true">
              {(index > 0 ? (rows[index - 1]?.links ?? []) : []).map((link, position) => (
                <line
                  key={`in-${position}`}
                  x1={laneX(link.to)}
                  y1={0}
                  x2={laneX(link.to)}
                  y2={ROW / 2}
                  style={{ stroke: color(link.to) }}
                  strokeWidth="2"
                />
              ))}
              {row.links.map((link, position) => (
                <path
                  key={`out-${position}`}
                  d={`M ${laneX(link.from)} ${ROW / 2} C ${laneX(link.from)} ${ROW}, ${laneX(link.to)} ${ROW / 2}, ${laneX(link.to)} ${ROW}`}
                  fill="none"
                  style={{ stroke: color(link.to) }}
                  strokeWidth="2"
                />
              ))}
              <circle cx={laneX(row.column)} cy={ROW / 2} r="4" style={{ fill: color(row.column) }} />
            </svg>
            <div className="flex min-w-0 flex-1 flex-col text-sm">
              <span className="flex min-w-0 items-center gap-1">
                {row.commit.refs.map((ref) => (
                  <Badge key={ref} size="sm" tone="info">
                    {ref}
                  </Badge>
                ))}
                <span className="truncate">{row.commit.subject}</span>
              </span>
              <span className="ui-hint ui-num">
                {row.commit.hash.slice(0, 7)} · {row.commit.author} · {date(row.commit.time)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {more && (
        <Button size="sm" variant="ghost" data-action="buff-git-more" onClick={() => void load(commits.length)}>
          {t("Show more")}
        </Button>
      )}
    </div>
  )
}
