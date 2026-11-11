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
  const group = view.element.querySelector<HTMLElement>('[data-component="buff-work-mode"]')
  const option = (value: string) => group?.querySelector<HTMLButtonElement>(`[data-work="${value}"]`) ?? null
  return { group, option, picked: pick.picked }
}

// #894: the work mode is one visible switch — Work, Plan, Setup — the one in force is marked, and
// every mode is one click away from any other. Setup used to be a lone toggle beside Plan.
test("the work mode is one switch of three; the mode in force is the checked one", async () => {
  const { group, option } = await mount("build", ["build", "plan", "setup"])
  expect(group?.getAttribute("role")).toBe("radiogroup")
  expect(group?.dataset.mode).toBe("work")
  expect(["work", "plan", "setup"].map((value) => option(value)?.getAttribute("aria-checked"))).toEqual(["true", "false", "false"])
})

test("from Work, Setup turns on the setup agent and Plan the plan agent", async () => {
  const { option, picked } = await mount("build", ["build", "plan", "setup"])
  act(() => option("setup")?.click())
  act(() => option("plan")?.click())
  expect(picked).toEqual(["setup", "plan"])
})

test("in Setup the switch shows Setup; Work leads back to the working agent, Plan to Plan", async () => {
  const { group, option, picked } = await mount("setup", ["setup", "plan", "build"])
  expect(group?.dataset.mode).toBe("setup")
  expect(option("setup")?.getAttribute("aria-checked")).toBe("true")
  act(() => option("work")?.click())
  act(() => option("plan")?.click())
  expect(picked).toEqual(["build", "plan"])
})

test("leaving Plan for Work never lands in Setup; the mode in force is not picked again", async () => {
  const { option, picked } = await mount("plan", ["setup", "plan", "build"])
  act(() => option("plan")?.click())
  act(() => option("work")?.click())
  expect(picked).toEqual(["build"])
})

test("a custom working agent reads as Work", async () => {
  const { group, option, picked } = await mount("review", ["review", "plan", "setup"])
  expect(group?.dataset.mode).toBe("work")
  act(() => option("setup")?.click())
  act(() => option("work")?.click())
  expect(picked[0]).toBe("setup")
})

test("without the setup or the plan agent its option is not offered", async () => {
  const { option } = await mount("build", ["build", "plan"])
  expect(option("setup")).toBeNull()
  expect(option("plan")).not.toBeNull()
  const bare = await mount("build", ["build"])
  expect(bare.group).toBeNull()
})
