// Файл из вложенного вызова Code Mode (#969): рисование в облаке идёт инструментом MCP через
// `execute`, и запись о нарисованном файле должна дойти до ленты — по ней клиент рисует карточку.
import { expect, test } from "bun:test"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Effect } from "effect"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  id: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
}
const sent = { file: "/home/user/pictures/cat.png", name: "cat.png", mime: "image/png", bytes: 6 }

const run = async (tools: Info[], code: string) => {
  const codeMode = CodeModeTool.create({ tools: new Map(tools.map((tool) => [tool.name, tool])) }, (_, tool, input, context) =>
    execute(tool, input, context),
  )
  const result = await Effect.runPromise(execute(codeMode, { code }, context))
  return result.metadata as { toolCalls: Array<Record<string, unknown>> }
}

test("a nested call that answers with a `sent` record carries it in the call's row", async () => {
  // Как инструмент MCP: структурный ответ становится результатом вызова.
  const draw: Info = {
    name: "draw_image",
    options: { namespace: "draw" },
    description: "Draw",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: { file: sent.file, status: "saved", sent }, content: "saved" }),
  }
  const metadata = await run([draw], `return await tools.draw.draw_image({ prompt: "cat", file: "cat" })`)
  expect(metadata.toolCalls).toEqual([
    { tool: "draw.draw_image", status: "completed", input: { prompt: "cat", file: "cat" }, sent },
  ])
})

test("a nested call that keeps the record in its metadata carries it too; a call without one has no `sent`", async () => {
  const hand: Info = {
    name: "hand_over",
    description: "Hand over",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: "done", content: "done", metadata: { sent } }),
  }
  const plain: Info = {
    name: "plain",
    description: "Plain",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: "ok", content: "ok" }),
  }
  const metadata = await run([hand, plain], `await tools.plain({ a: 1 }); return await tools.hand_over({ a: 1 })`)
  expect(metadata.toolCalls).toEqual([
    { tool: "plain", status: "completed", input: { a: 1 } },
    { tool: "hand_over", status: "completed", input: { a: 1 }, sent },
  ])
})

test("a malformed record is not passed on", async () => {
  const odd: Info = {
    name: "odd",
    description: "Odd",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: { sent: { file: "x" } }, content: "x" }),
  }
  const metadata = await run([odd], `return await tools.odd({})`)
  expect(metadata.toolCalls).toEqual([{ tool: "odd", status: "completed" }])
})
