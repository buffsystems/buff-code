import { expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode/client/promise"
import { session } from "../../core/data/fixtures"
import { emptyData } from "../../core/data/state"
import { sessionActivity } from "./activity"

const base = emptyData("/repo")
const state = {
  ...base,
  session: {
    ...base.session,
    info: { root: session("root"), child: session("child", { parentID: "root" }) },
    family: { root: ["root", "child"] },
    active: { child: "running" as const },
  },
}

test("a tab works while any session of its family runs", () => {
  expect(sessionActivity(state, "root")).toEqual({ working: true, unread: false })
  expect(sessionActivity({ ...state, session: { ...state.session, active: {} } }, "root").working).toBe(false)
})

test("a waiting permission marks the tab instead of the working indicator", () => {
  const request = { id: "per_1", sessionID: "child" } as unknown as PermissionRequest
  const waiting = { ...state, session: { ...state.session, permission: { child: [request] } } }
  expect(sessionActivity(waiting, "root")).toEqual({ working: false, unread: true })
})
