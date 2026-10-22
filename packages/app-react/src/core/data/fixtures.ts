import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"

let sequence = 0

/** A server event for tests: type, data and, optionally, the Location it carries. */
export function event<Type extends OpenCodeEvent["type"]>(
  type: Type,
  data: Extract<OpenCodeEvent, { type: Type }>["data"],
  extra: { location?: { directory: string }; created?: number; id?: string } = {},
) {
  sequence++
  return {
    id: extra.id ?? `evt_${String(sequence).padStart(4, "0")}`,
    type,
    created: extra.created ?? sequence,
    data,
    ...(extra.location ? { location: extra.location } : {}),
  } as Extract<OpenCodeEvent, { type: Type }>
}

export function session(id: string, patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    projectID: "prj_1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: id,
    location: { directory: "/repo" },
    ...patch,
  }
}

export const model = { id: "test", providerID: "buff" }
