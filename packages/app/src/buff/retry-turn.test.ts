// «Повторить» у отказа хода (#458): то же сообщение ещё раз, со всем, что к нему приложено.
import { expect, test } from "bun:test"
import { retryInput } from "./retry-turn"

const message = {
  id: "msg_1",
  type: "user" as const,
  text: "посмотри @notes.txt",
  files: [
    {
      data: "aGVsbG8=",
      mime: "text/plain",
      source: { type: "uri" as const, uri: "file:///w/notes.txt" },
      name: "notes.txt",
    },
  ],
  agents: [{ name: "build" }],
  skills: [],
  metadata: { displayText: "посмотри notes.txt" },
  time: { created: 1 },
}

test("the same text, agents, skills and metadata go again", () => {
  expect(retryInput("ses_1", message)).toMatchObject({
    sessionID: "ses_1",
    text: "посмотри @notes.txt",
    agents: [{ name: "build" }],
    skills: [],
    metadata: { displayText: "посмотри notes.txt" },
  })
})

test("attached files travel as the content they were sent with", () => {
  expect(retryInput("ses_1", message).files).toEqual([
    { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt", description: undefined, mention: undefined },
  ])
})

test("a message without files sends none", () => {
  expect(retryInput("ses_1", { ...message, files: undefined }).files).toBeUndefined()
})
