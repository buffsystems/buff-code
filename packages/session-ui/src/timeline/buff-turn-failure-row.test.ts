// Buff (#458): строка отказа хода несёт сам отказ — тип, код ответа, чья модель отвечала и на
// какое сообщение. По ним приложение объясняет причину и повторяет ход.
import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { Timeline } from "./projection"

const turn = (error: { type: string; message: string; status?: number }) =>
  [
    { id: "msg_1", type: "user", text: "сделай", time: { created: 1 } },
    {
      id: "msg_2",
      type: "assistant",
      agent: "build",
      model: { id: "buff", providerID: "buff" },
      content: [],
      finish: "error",
      error,
      time: { created: 2, completed: 3 },
    },
  ] as SessionMessageInfo[]

const failureOf = (source: SessionMessageInfo[]) =>
  Timeline.constructSessionMessageRows(source, false, { type: "idle" }).rows.flatMap((row) =>
    row._tag === "Error" ? [row.failure] : [],
  )

test("a failed turn carries the refusal as it came", () => {
  expect(failureOf(turn({ type: "provider.auth", message: "not a member of acme", status: 403 }))).toEqual([
    { userMessageID: "msg_1", providerID: "buff", type: "provider.auth", message: "not a member of acme", status: 403 },
  ])
})

test("a refusal without a response code carries none", () => {
  expect(failureOf(turn({ type: "provider.transport", message: "fetch failed" }))).toEqual([
    { userMessageID: "msg_1", providerID: "buff", type: "provider.transport", message: "fetch failed" },
  ])
})

// Ход, в котором модель ничего не вернула, раньше не оставлял под сообщением ничего.
const answered = (content: unknown[], extra: Record<string, unknown> = {}) =>
  [
    { id: "msg_1", type: "user", text: "сделай", time: { created: 1 } },
    {
      id: "msg_2",
      type: "assistant",
      agent: "build",
      model: { id: "buff", providerID: "buff" },
      content,
      finish: "stop",
      time: { created: 2, completed: 3 },
      ...extra,
    },
  ] as SessionMessageInfo[]

test("a finished turn with nothing in the answer says the model returned nothing", () => {
  expect(failureOf(answered([]))).toEqual([
    { userMessageID: "msg_1", providerID: "buff", type: "empty-answer", message: "" },
  ])
})

test("an answer with text is not empty", () => {
  expect(failureOf(answered([{ type: "text", text: "готово" }]))).toEqual([])
})

test("a step that only called tools, or a turn still running, is not an empty answer", () => {
  expect(failureOf(answered([], { finish: "tool-calls" }))).toEqual([])
  const running = answered([], { finish: undefined, time: { created: 2 } })
  expect(
    Timeline.constructSessionMessageRows(running, true, { type: "busy" }).rows.filter((row) => row._tag === "Error"),
  ).toEqual([])
})

// Ход, упавший до первого шага модели: в истории есть только отметка о неудаче.
test("a turn that failed before the model answered says so — it used to leave nothing", () => {
  const source = [
    {
      id: "msg_1",
      type: "user",
      text: "сделай",
      metadata: { model: { providerID: "buff", modelID: "buff" } },
      time: { created: 1 },
    },
    { id: "msg_2", type: "idle", outcome: "failed", time: { created: 2 } },
  ] as SessionMessageInfo[]
  expect(failureOf(source)).toEqual([{ userMessageID: "msg_1", providerID: "buff", type: "turn-failed", message: "" }])
})

test("a turn that failed with an answer already shows that answer's error, once", () => {
  const source = [
    ...turn({ type: "provider.auth", message: "not a member of acme", status: 403 }),
    { id: "msg_3", type: "idle", outcome: "failed", time: { created: 4 } },
  ] as SessionMessageInfo[]
  expect(failureOf(source).map((failure) => failure?.type)).toEqual(["provider.auth"])
})

test("a finished or interrupted turn without an answer is not a failure", () => {
  for (const outcome of ["succeeded", "interrupted"]) {
    const source = [
      { id: "msg_1", type: "user", text: "сделай", time: { created: 1 } },
      { id: "msg_2", type: "idle", outcome, time: { created: 2 } },
    ] as SessionMessageInfo[]
    expect(failureOf(source)).toEqual([])
  }
})
