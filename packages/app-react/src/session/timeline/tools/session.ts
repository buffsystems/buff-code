// What tool rows read from the session around them (#584), in place of session-ui's data
// context: the session's directory, the location's agents, running shells and child sessions.

import type { ShellOutputInput } from "@opencode/client/promise"
import { locationKey, type DataState } from "../../../core/data/state"
import { shallowEqual, useStore } from "../../../react/use-store"
import { useTimeline } from "../context"

const noAgents: { name: string; color?: string }[] = []

function sessionLocation(state: DataState, sessionID: string) {
  return state.session.info[sessionID]?.location ?? state.defaultLocation
}

/** The session's working directory, which paths in tool rows are shown relative to. */
export function useSessionDirectory() {
  const timeline = useTimeline()
  return useStore(timeline.server.data.state, (state) => sessionLocation(state, timeline.sessionID).directory)
}

export function useAgents() {
  const timeline = useTimeline()
  return useStore(
    timeline.server.data.state,
    (state) => state.location[locationKey(sessionLocation(state, timeline.sessionID))]?.agent ?? noAgents,
  )
}

/** A shell of any loaded location is still running. */
export function useShellRunning(id: string | undefined) {
  const timeline = useTimeline()
  return useStore(
    timeline.server.data.state,
    (state) => !!id && Object.values(state.location).some((location) => !!location.shell?.[id]),
  )
}

export function useShellOutputLoader() {
  const timeline = useTimeline()
  return (input: ShellOutputInput) => timeline.server.api().shell.output(input)
}

/** A child session's status: whether it still runs. */
export function useSessionRunning(id: string | undefined) {
  const timeline = useTimeline()
  return useStore(timeline.server.data.state, (state) => !!id && state.session.active[id] === "running")
}

/** The latest child session started for a task call, matched by its description. */
export function useTaskSession(input: Record<string, unknown>) {
  const timeline = useTimeline()
  const description = typeof input.description === "string" ? input.description : ""
  return useStore(
    timeline.server.data.state,
    (state) =>
      Object.values(state.session.info)
        .filter((session) => session.parentID === timeline.sessionID && !session.time?.archived)
        .filter((session) => (description ? session.title?.startsWith(description) : true))
        .toSorted((a, b) => (b.time.created ?? 0) - (a.time.created ?? 0))[0]?.id,
    shallowEqual,
  )
}
