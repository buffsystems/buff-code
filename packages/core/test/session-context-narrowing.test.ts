// R15-03 (#969): the `permission.tools` hook narrows a session's tools — it never widens them. Only
// its deny rules join the session's permissions; an allow from a plugin changes nothing.
import { expect, test } from "bun:test"
import { SessionContext } from "../src/session/context"

test("only deny rules from the tools hook narrow the turn's tools", () => {
  const deny = { action: "mail_send", resource: "*", effect: "deny" } as const
  const allow = { action: "shell", resource: "*", effect: "allow" } as const
  const ask = { action: "edit", resource: "*", effect: "ask" } as const
  expect(SessionContext.narrowing([deny, allow, ask])).toEqual([deny])
  expect(SessionContext.narrowing([])).toEqual([])
})
