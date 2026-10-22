// Сценарии (#448): запуск подтверждает человек всегда; черновики скриптов правятся без вопросов; актёру — свои инструменты.
import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"
import { WorkflowPolicy } from "../../src/buff/workflow/policy"

const event = (action: string, resources: string[], effect: "allow" | "ask" | "deny") => ({ action, resources, effect })

describe("confirmation", () => {
  test("allow-all does not skip a workflow run; ask and deny stay", () => {
    const policy = WorkflowPolicy.make("/data/workflow-drafts")
    expect(policy.effect(event("buff_workflow", ["x"], "allow"))).toBe("ask")
    expect(policy.effect(event("buff_workflow", ["x"], "deny"))).toBe("deny")
    expect(policy.effect(event("edit", ["src/a.ts"], "ask"))).toBe("ask")
  })
})

describe("drafts", () => {
  const policy = WorkflowPolicy.make("/data/workflow-drafts")
  test("editing a draft asks nothing", () => {
    expect(policy.effect(event("edit", ["/data/workflow-drafts/wf1.ts"], "ask"))).toBe("allow")
    expect(policy.effect(event("external_directory", ["/data/workflow-drafts/*"], "ask"))).toBe("allow")
  })
  test("anything else outside stays a question", () => {
    expect(policy.effect(event("edit", ["/data/workflow-drafts/../secret.ts"], "ask"))).toBe("ask")
    expect(policy.effect(event("edit", ["/data/workflow-drafts/wf1.ts", "/etc/passwd"], "ask"))).toBe("ask")
    expect(policy.effect(event("shell", ["/data/workflow-drafts/wf1.ts"], "ask"))).toBe("ask")
  })
})

describe("actor sessions", () => {
  test("cannot start workflows of their own; keep the parent's rules", () => {
    const parent: Permission.Ruleset = [{ action: "edit", resource: "*", effect: "ask" }]
    const rules = WorkflowPolicy.actorRules(parent)
    expect(rules[0]).toEqual(parent[0]!)
    expect(Permission.evaluate(WorkflowPolicy.ORCHESTRATE, "*", rules).effect).toBe("deny")
    expect(Permission.evaluate(WorkflowPolicy.ACTOR, "*", rules).effect).toBe("allow")
  })
})
