// The review of a session's changes (#584): the Solid createSessionReview as a React hook — the
// changes mode (working tree or branch), the workspace's diff read through React Query and
// re-read when files may have changed or a turn ends, the selected file, and line comments staged
// in the prompt context for the composer.

import { filesMayHaveChanged } from "@opencode/app/react-reuse/files-changed"
import {
  reviewDiffDirectory,
  reviewDiffNeedsLoad,
  reviewRootDirectory,
} from "@opencode/app/react-reuse/review-diff-kinds"
import type { FileDiffInfo } from "@opencode/client/promise"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { promptContext, selectionFromLines, type LineComment, type LineRange } from "../../../core/prompt-context"
import { locationKey } from "../../../core/data/state"
import { useConnection, useServerData } from "../../../react/core"
import { useStore } from "../../../react/use-store"
import { useSessionView } from "../../context"
import { reviewFileOf, reviewModeOf, type ChangeMode } from "../layout"
import type { PaneSession } from "../session"

type VcsMode = "git" | "branch"

/**
 * Whether the changes are read (Buff, #467): without git there is nothing to read or to wait for —
 * the Solid window's reviewReady.
 */
export function reviewReady(input: { mode: ChangeMode; pending: boolean; noGit: boolean }) {
  if (input.noGit) return true
  if (input.mode === "git" || input.mode === "branch") return !input.pending
  return true
}

export type ReviewEmptyState = "no-git" | "loading" | "empty"

export function reviewEmptyState(input: { mode: ChangeMode; ready: boolean; noGit: boolean }): ReviewEmptyState {
  if (input.noGit) return "no-git"
  if ((input.mode === "git" || input.mode === "branch") && !input.ready) return "loading"
  return "empty"
}
const EMPTY_DIFFS: FileDiffInfo[] = []
const NO_COMMENTS: LineComment[] = []

export function useReviewModel(session: PaneSession, wanted: boolean) {
  const { server, directory, project, sessionKey, window } = session
  const queries = useQueryClient()
  const view = useSessionView()
  const connected = useConnection(server).status === "connected"
  const layout = useStore(window.layout.layout, (state) => state)
  const storedMode = sessionKey ? reviewModeOf(layout, sessionKey) : undefined
  const mode: ChangeMode = storedMode ?? "git"
  const selected = sessionKey ? reviewFileOf(layout, sessionKey) : undefined
  const vcs = useServerData(server, (state) =>
    directory === undefined ? undefined : state.location[locationKey({ directory })]?.vcs,
  )
  const hasVcs = !!project?.vcs

  useEffect(() => {
    if (directory === undefined || !connected || !hasVcs) return
    void server.data.location.vcs.sync({ directory }).catch(() => undefined)
  }, [server, directory, connected, hasVcs])

  const options = useMemo(() => {
    const list: ChangeMode[] = []
    if (!hasVcs) return list
    list.push("git")
    const branch = vcs?.branch
    if (branch?.current && branch.default && branch.current !== branch.default) list.push("branch")
    return list
  }, [hasVcs, vcs?.branch?.current, vcs?.branch?.default])

  const vcsMode: VcsMode | undefined = mode === "git" || mode === "branch" ? mode : undefined
  const vcsKey = useMemo(
    () => [server.key, "session-vcs", directory ?? "", vcs?.branch?.current ?? "", vcs?.branch?.default ?? ""] as const,
    [server.key, directory, vcs?.branch?.current, vcs?.branch?.default],
  )

  const query = useQuery({
    queryKey: [...vcsKey, vcsMode],
    enabled: connected && wanted && hasVcs && directory !== undefined && vcsMode !== undefined,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: () =>
      server
        .api()
        .vcs.diff({ location: { directory: directory! }, mode: vcsMode === "git" ? "working" : "branch" })
        .then((result) => result.data),
  })

  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const refresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void queries.invalidateQueries({ queryKey: vcsKey }), 100)
  }, [queries, vcsKey])
  useEffect(() => () => clearTimeout(refreshTimer.current), [])

  useEffect(() => {
    if (directory === undefined) return
    return server.event.location(directory).listen((event) => {
      if (filesMayHaveChanged(event.type)) refresh()
    })
  }, [server, directory, refresh])

  // A turn that ends may have changed files.
  const status = useServerData(server, (state) => state.session.active[session.sessionID])
  const previousStatus = useRef(status)
  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = status
    if (status !== "idle" && status !== undefined) return
    if (previous === undefined || previous === "idle") return
    refresh()
  }, [status, refresh])

  // A mode the workspace no longer offers falls back to the first one it does.
  useEffect(() => {
    if (!sessionKey || !connected || !project) return
    if (options.includes(mode)) return
    const next = options[0]
    if (next) window.layout.review(sessionKey).setMode(next)
  }, [sessionKey, connected, project, options, mode, window])

  const diffs = vcsMode && query.isFetched ? (query.data ?? EMPTY_DIFFS) : EMPTY_DIFFS
  const activeFile = selected && diffs.some((diff) => diff.file === selected) ? selected : diffs[0]?.file
  const noGit = !!project && !project.vcs
  const ready = reviewReady({ mode, pending: query.isPending, noGit })

  const loadDiff = useCallback(
    async (path: string, version?: number): Promise<FileDiffInfo | undefined> => {
      if (!vcsMode || directory === undefined) return
      const root = reviewRootDirectory(project?.canonical ?? directory)
      const scoped = reviewDiffDirectory(root, path)
      const source = diffs.find((diff) => diff.file === path)
      const valid = (diff: FileDiffInfo | undefined) => {
        if (!diff || !source) return
        if (diff.additions !== source.additions || diff.deletions !== source.deletions) return
        if (reviewDiffNeedsLoad(diff)) return
        return diff
      }
      const request = (scope: string, context?: number) =>
        queries
          .fetchQuery({
            queryKey: [...vcsKey, vcsMode, "directory", scope, context, version],
            staleTime: Number.POSITIVE_INFINITY,
            retry: 2,
            queryFn: () =>
              server
                .api()
                .vcs.diff({ location: { directory: scope }, mode: vcsMode === "git" ? "working" : "branch", context })
                .then((result) => result.data),
          })
          .then((result) => result.find((diff) => diff.file === path))
      if (scoped !== root) {
        const found = valid(await request(scoped).catch(() => undefined))
        if (found) return found
      }
      return valid(await request(root, 3).catch(() => undefined))
    },
    [vcsMode, directory, project?.canonical, diffs, queries, vcsKey, server],
  )

  const focusFile = useCallback(
    (path: string) => {
      view.openReview()
      if (!sessionKey) return
      window.layout.review(sessionKey).openPath(path)
      window.layout.review(sessionKey).setFile(path)
    },
    [view, sessionKey, window],
  )

  const comments = useStore(promptContext.store, (state) =>
    sessionKey ? (state[sessionKey]?.comments ?? NO_COMMENTS) : NO_COMMENTS,
  )
  const focus = useStore(promptContext.store, (state) => (sessionKey ? (state[sessionKey]?.focus ?? null) : null))

  const commentActions = useMemo(() => {
    const key = sessionKey ?? ""
    return {
      add(input: { file: string; selection: LineRange; comment: string; preview?: string }) {
        const saved = promptContext.comments.add(key, { file: input.file, selection: input.selection, comment: input.comment })
        promptContext.context.add(key, {
          type: "file",
          path: input.file,
          selection: selectionFromLines(input.selection),
          comment: input.comment,
          commentID: saved.id,
          commentOrigin: "review",
          preview: input.preview,
        })
      },
      update(input: { id: string; file: string; comment: string; preview?: string }) {
        promptContext.comments.update(key, input.file, input.id, input.comment)
        promptContext.context.updateComment(key, input.file, input.id, {
          comment: input.comment,
          ...(input.preview ? { preview: input.preview } : {}),
        })
      },
      remove(input: { id: string; file: string }) {
        promptContext.comments.remove(key, input.file, input.id)
        promptContext.context.removeComment(key, input.file, input.id)
      },
      setFocus: (next: { file: string; id: string } | null) => promptContext.comments.setFocus(key, next),
    }
  }, [sessionKey])

  return {
    mode,
    options,
    setMode: (next: ChangeMode) => sessionKey && window.layout.review(sessionKey).setMode(next),
    diffs,
    diffVersion: query.dataUpdatedAt,
    count: diffs.length,
    hasChanges: diffs.length > 0,
    canReview: true,
    noGit,
    ready,
    activeFile,
    loadDiff,
    focusFile,
    refresh,
    comments: { comments, focus, ...commentActions },
  }
}

export type ReviewModel = ReturnType<typeof useReviewModel>
