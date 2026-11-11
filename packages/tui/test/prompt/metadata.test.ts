import { describe, expect, test } from "bun:test"
import { promptMetadataLayout } from "../../src/component/prompt/metadata"

// #894: the work mode — Work, Plan, Setup — stands in the prompt's row in place of the lone agent
// name, so the mode in force is seen and the others are one shift+tab away.
describe("the work-mode switch in the prompt's row", () => {
  const base = { terminalWidth: 120, agent: "Setup", modes: "Work Plan [Setup]", model: "GLM 5.3", provider: "litellm" }

  test("takes the agent's place while the row has room", () => {
    expect(promptMetadataLayout({ ...base, width: 100 }).modes).toBe(true)
  })

  test("a row too narrow for it keeps the agent's name — the mode is still named", () => {
    const narrow = promptMetadataLayout({ ...base, width: 24 })
    expect(narrow.modes).toBeUndefined()
    expect(narrow.agent).toBe("Setup")
  })

  test("without a switch the row is as before; a tiny terminal shows neither", () => {
    expect(promptMetadataLayout({ ...base, modes: undefined, width: 100 }).modes).toBeUndefined()
    expect(promptMetadataLayout({ ...base, terminalWidth: 40, width: 30 }).modes).toBeUndefined()
  })
})
