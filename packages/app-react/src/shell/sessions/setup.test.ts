import { expect, test } from "bun:test"
import type { OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import type { BuffSetup } from "@opencode/schema/buff-setup"
import { followSetupOpened, openSetupSession } from "./setup"

const info = (id: string) => ({ id, agent: "setup" }) as SessionInfo

function fakeApi(opened: BuffSetup.Opened[] = []) {
  const calls: string[] = []
  const api = {
    rpc: () => ({
      open: (input: unknown) => {
        calls.push(`open ${JSON.stringify(input)}`)
        return Promise.resolve({ session: "ses_new" })
      },
      events: {
        subscribe: async function* () {
          for (const data of opened) yield { data }
        },
      },
    }),
    session: {
      get: (input: { sessionID: string }) => {
        calls.push(`get ${input.sessionID}`)
        return Promise.resolve(info(input.sessionID))
      },
    },
  } as unknown as OpenCodeClient
  return { api, calls }
}

test("«+» of the Setup section: the core opens a setup session, the window shows it as a tab", async () => {
  const { api, calls } = fakeApi()
  const shown: string[] = []
  await openSetupSession(api, (session) => shown.push(session.id))
  expect(calls).toEqual(["open {}", "get ses_new"])
  expect(shown).toEqual(["ses_new"])
})

test("a setup session the model opened from a session of this window is shown; every opening refreshes the list", async () => {
  const { api } = fakeApi([
    { session: "ses_a" },
    { session: "ses_b", from: "ses_here" },
    { session: "ses_c", from: "ses_other" },
  ])
  const shown: string[] = []
  let refreshed = 0
  await followSetupOpened(api, {
    signal: new AbortController().signal,
    known: (id) => id === "ses_here",
    refresh: () => refreshed++,
    show: (session) => shown.push(session.id),
  })
  await Promise.resolve()
  expect(refreshed).toBe(3)
  expect(shown).toEqual(["ses_b"])
})
