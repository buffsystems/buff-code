import { expect, test } from "bun:test"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { agentLabel } from "./agent-label"

const t = (text: string) => `«${text}»`

test("the engine's agents go by the work modes' words", () => {
  expect(agentLabel("build", t)).toBe("«Work»")
  expect(agentLabel("plan", t)).toBe("«Plan»")
  expect(agentLabel(BuffSetup.AGENT, t)).toBe("«Self-setup»")
})

test("an agent of the person's own keeps its name", () => {
  expect(agentLabel("release-notes", t)).toBe("release-notes")
})
