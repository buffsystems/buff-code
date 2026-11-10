import { base64Encode } from "@opencode/util/encode"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Page } from "../utils/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

// #762: the working subagents sit behind an icon with their count in the composer's bottom row;
// a click lists them and opens a subagent's session. A finished one leaves the list.
const directory = "C:/OpenCode/SubagentsIcon"
const projectID = "proj_subagents_icon"
const parentID = "ses_subagents_parent"
const childID = "ses_subagents_child"
const parentTitle = "Parent with subagents"
const description = "Review the facts"

test.use({ viewport: { width: 1440, height: 900 } })

test("the composer shows the working subagents and opens one's session", async ({ page }) => {
  await setup(page, messages(false))
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  const icon = page.getByRole("button", { name: "1 subagent at work", exact: true })
  await expect(icon).toBeVisible()
  await icon.click()
  const item = page.locator(`[data-component="composer-subagents-list"] a[href="${sessionHref(childID)}"]`)
  await expect(item).toContainText(description)
  await item.click()
  await expect(page).toHaveURL(new RegExp(`/server/.+/session/${childID}$`), { timeout: 15_000 })
})

test("a finished subagent leaves the composer", async ({ page }) => {
  await setup(page, messages(true))
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await expect(page.getByRole("button", { name: /subagents? at work/ })).toHaveCount(0)
})

async function setup(page: Page, items: SessionMessageInfo[]) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "subagents-icon",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    sessions: [
      session(parentID, parentTitle, 1700000000000),
      session(childID, description, 1700000001000, { parentID }),
    ],
    pageMessages: (sessionID) => ({ items: sessionID === parentID ? items : [] }),
  })
  await configurePage(page)
}

/** A background subagent: its call completes at once with `status: running`; its result comes later. */
function messages(finished: boolean): SessionMessageInfo[] {
  return [
    { id: "msg_user_0001", type: "user", time: { created: 1700000000000 }, text: "Review in the background" },
    {
      id: "msg_assistant_0001",
      type: "assistant",
      time: { created: 1700000001000, completed: 1700000002000 },
      model: { id: "claude-opus-4-6", providerID: "opencode" },
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "call_subagent_0001",
          name: "subagent",
          time: { created: 1700000001000, ran: 1700000001000, completed: 1700000001500 },
          state: {
            status: "completed",
            input: { description, agent: "review", prompt: "Check the facts.", background: true },
            content: [{ type: "text", text: "The subagent is working in the background" }],
            metadata: { sessionID: childID, status: "running" },
          },
        },
      ],
    },
    ...(finished
      ? ([
          {
            id: "msg_synthetic_0001",
            type: "synthetic",
            time: { created: 1700000003000 },
            text: "Subagent finished",
            metadata: { source: "subagent", childID },
          },
        ] as unknown as SessionMessageInfo[])
      : []),
  ]
}

function session(id: string, title: string, created: number, extra?: Record<string, unknown>) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
    ...extra,
  }
}


async function configurePage(page: Page) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  await page.addInitScript(
    ({ directory, server, sessionId }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify([{ type: "session", server, sessionId }]))
    },
    { directory, server, sessionId: parentID },
  )
}

function sessionHref(sessionID: string) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
