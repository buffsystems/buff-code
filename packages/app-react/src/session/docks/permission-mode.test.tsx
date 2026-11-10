import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { settle } from "../../test/render"
import type { ModelSelectionHandle } from "../composer/models/use-selection"
import { useSession } from "../context"
import { renderSessionSlot } from "../test"
import { PermissionModeControl } from "./permission-mode"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

/** The composer's selection: an agent of the list, and the agents picked through the control. */
function selection(agent: string, names: string[]) {
  const picked: string[] = []
  const agents = names.map((name) => ({ name, mode: "primary" }))
  const handle = {
    selection: { agent: agents.find((item) => item.name === agent), agents },
    setAgent: (name: string) => picked.push(name),
  } as unknown as ModelSelectionHandle
  return { handle, picked }
}

function Control(props: { handle: ModelSelectionHandle }) {
  const { server, sessionID } = useSession()
  return <PermissionModeControl selection={props.handle} server={server} sessionID={sessionID} />
}

async function mount(agent: string, names: string[]) {
  const pick = selection(agent, names)
  const view = renderSessionSlot(<Control handle={pick.handle} />)
  cleanup.push(view.unmount)
  await settle()
  const button = view.element.querySelector<HTMLButtonElement>('[data-action="buff-setup-toggle"]')
  return { button, picked: pick.picked }
}

test("the Setup toggle sits beside Plan: it turns on the setup agent (#860)", async () => {
  const { button, picked } = await mount("build", ["build", "plan", "setup"])
  expect(button?.hidden).toBe(false)
  expect(button?.dataset.active).toBe("false")
  act(() => button?.click())
  expect(picked).toEqual(["setup"])
})

test("in Setup the toggle is on and leads back to the working agent, not to Plan", async () => {
  const { button, picked } = await mount("setup", ["setup", "plan", "build"])
  expect(button?.dataset.active).toBe("true")
  act(() => button?.click())
  expect(picked).toEqual(["build"])
})

test("leaving Plan never lands in Setup", async () => {
  const { picked, button } = await mount("plan", ["setup", "plan", "build"])
  const plan = button?.parentElement?.querySelector<HTMLButtonElement>('[data-action="buff-plan-toggle"]')
  act(() => plan?.click())
  expect(picked).toEqual(["build"])
})

test("without the setup agent the toggle is hidden", async () => {
  const { button } = await mount("build", ["build", "plan"])
  expect(button?.hidden).toBe(true)
})
