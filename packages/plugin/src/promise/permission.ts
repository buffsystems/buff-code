import type { PermissionApi } from "@opencode/client/promise/api"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import type { Hooks } from "./registration.js"

export interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect
  message?: string
}

/**
 * Before a turn's tools are chosen. Deny rules added to `rules` narrow this Session's tools as its
 * own permissions do: a tool wholly denied leaves the direct list, Code Mode's catalog and its
 * search. Only deny rules count — the hook narrows, never widens.
 */
export interface PermissionTools {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  rules: Array<Permission.Ruleset[number]>
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
  readonly tools: PermissionTools
}

export type PermissionDomain = Pick<PermissionApi, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
}
