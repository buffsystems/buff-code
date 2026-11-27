import { expect, test } from "bun:test"
import { foldChat } from "@buff/ui/chat-logic"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { failureOf, isRequest, replaceable, requestText, tail, toChat } from "./chat"

const user = (id: string, text: string): SessionMessageInfo => ({ type: "user", id, text, time: { created: 1 } })
const answer = (id: string, completed?: number): SessionMessageInfo => ({
  type: "assistant",
  id,
  agent: "build",
  model: { id: "sonnet", providerID: "rig" },
  time: { created: 2, ...(completed ? { completed } : {}) },
  content: [
    {
      type: "tool",
      id: "t1",
      name: "read",
      state: { status: "completed", input: { path: "a.txt" }, content: [{ type: "text", text: "hello" }] },
      time: { created: 2, ran: 3, completed: 4 },
    },
    { type: "text", text: "Done" },
  ],
})

test("a turn's messages pass as the shared chat logic reads them", () => {
  const chat = toChat(
    [user("u1", "read it"), answer("a1", 9), { type: "idle", id: "i1", outcome: "succeeded", time: { created: 9 } }],
    false,
  )
  expect(chat.map((m) => m.type)).toEqual(["user", "assistant", "idle"])
  const rows = foldChat(chat, { running: false, waiting: false })
  const turn = rows[0]?.kind === "turn" ? rows[0].turn : undefined
  expect(turn?.status).toBe("done")
  expect(turn?.steps).toBe(1)
  expect(turn?.answer?.text).toBe("Done")
  expect(turn?.tier).toBe("sonnet")
})

test("the window's own marks make no rows of a chat", () => {
  const chat = toChat(
    [
      {
        type: "model-switched",
        id: "m1",
        time: { created: 0 },
        model: { id: "sonnet", providerID: "rig" },
      } as SessionMessageInfo,
      user("u1", "hi"),
    ],
    false,
  )
  expect(chat.map((m) => m.id)).toEqual(["u1"])
})

test("while the session works, the newest answer's last part is still being written", () => {
  const live = toChat([user("u1", "go"), answer("a1")], true)
  const last = live[1]?.type === "assistant" ? live[1].content.at(-1) : undefined
  expect(last && "streaming" in last && last.streaming).toBe(true)
  // An answer that ended, or a session at rest, has nothing being written.
  const done = toChat([user("u1", "go"), answer("a1", 9)], true)
  const ended = done[1]?.type === "assistant" ? done[1].content.at(-1) : undefined
  expect(ended && "streaming" in ended).toBe(false)
  const rest = toChat([user("u1", "go"), answer("a1")], false)
  const still = rest[1]?.type === "assistant" ? rest[1].content.at(-1) : undefined
  expect(still && "streaming" in still).toBe(false)
})

test("a request's files go with it", () => {
  const chat = toChat(
    [
      {
        type: "user",
        id: "u1",
        text: "look",
        time: { created: 1 },
        files: [{ data: "AAAA", mime: "image/png", name: "a.png", source: { type: "upload" } as never }],
      },
    ],
    false,
  )
  expect(chat[0]?.type === "user" && chat[0].files).toEqual([{ mime: "image/png", data: "AAAA", name: "a.png" }])
})

test("a failed turn names its error, provider, model and the request's files", () => {
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: "u1",
      text: "look",
      time: { created: 1 },
      files: [{ data: "AAAA", mime: "image/png", name: "a.png", source: { type: "upload" } as never }],
    },
    {
      type: "assistant",
      id: "a1",
      agent: "build",
      model: { id: "sonnet", providerID: "rig" },
      time: { created: 2, completed: 3 },
      content: [],
      error: { type: "provider.auth", message: "no key", status: 401 },
    },
    user("u2", "next"),
  ]
  expect(failureOf({ user: { id: "u1" } }, messages)).toEqual({
    userMessageID: "u1",
    providerID: "rig",
    type: "provider.auth",
    message: "no key",
    status: 401,
    attachments: [{ mime: "image/png", name: "a.png" }],
    modelID: "sonnet",
  })
  // The next turn has no failed answer; a turn without a request has none to name.
  expect(failureOf({ user: { id: "u2" } }, messages)).toBeUndefined()
  expect(failureOf({}, messages)).toBeUndefined()
})

test("a request shows what the person wrote, not the notes for the model", () => {
  const message = {
    type: "user",
    id: "u1",
    time: { created: 1 },
    text: "Fix it\nThe user made the following comment regarding lines 3 through 9 of src/a.ts: rename this",
    metadata: {
      displayText: "Fix it",
      comments: [
        { path: "src/a.ts", comment: "rename this", selection: { startLine: 3, startChar: 0, endLine: 9, endChar: 0 } },
      ],
      attachments: [{ name: "plan.pdf", mime: "application/pdf", path: "/tmp/plan.pdf" }],
    },
  } as SessionMessageInfo
  expect(message.type === "user" && requestText(message)).toBe("Fix it\nplan.pdf\nsrc/a.ts:3–9 — rename this")
  // A bare comment sent on its own, from before the presentation was kept.
  const bare = {
    type: "user",
    id: "u2",
    time: { created: 1 },
    text: "The user made the following comment regarding line 4 of b.ts: why?",
  } as SessionMessageInfo
  expect(bare.type === "user" && requestText(bare)).toBe("b.ts:4 — why?")
  const plain = user("u3", "hello")
  expect(plain.type === "user" && requestText(plain)).toBe("hello")
})

test("a file only mentioned in the text is not shown as an attachment", () => {
  const chat = toChat(
    [
      {
        type: "user",
        id: "u1",
        text: "see @a.ts",
        time: { created: 1 },
        files: [
          {
            data: "AAAA",
            mime: "text/plain",
            name: "a.ts",
            source: { type: "upload" },
            mention: { start: 4, end: 9 },
          } as never,
        ],
      },
    ],
    false,
  )
  const rows = foldChat(chat, { running: false, waiting: false })
  expect(rows[0]?.kind === "turn" && rows[0].turn.user?.files).toEqual([])
})

test("a shell command is a request with its output as the one step", () => {
  const chat = toChat(
    [
      {
        type: "shell",
        id: "s1",
        shellID: "sh1",
        command: "ls",
        status: "exited",
        exit: 0,
        time: { created: 1, completed: 2 },
        output: { output: "a.txt", cursor: 0, size: 5, truncated: false },
      },
    ],
    false,
  )
  expect(chat.map((m) => m.type)).toEqual(["user", "assistant", "idle"])
  const rows = foldChat(chat, { running: false, waiting: false })
  const turn = rows[0]?.kind === "turn" ? rows[0].turn : undefined
  expect(turn?.user?.text).toBe("! ls")
  expect(turn?.status).toBe("done")
  expect(turn?.steps).toBe(1)
  expect(isRequest([user("u1", "hi")], "u1")).toBe(true)
  expect(isRequest([user("u1", "hi")], "s1")).toBe(false)
})

test("a shell command that ended with an error code is a failed step, a running one — a step at work", () => {
  const sh = (status: "running" | "exited", exit?: number): SessionMessageInfo => ({
    type: "shell",
    id: "s1",
    shellID: "sh1",
    command: "false",
    status,
    ...(exit !== undefined ? { exit } : {}),
    time: { created: 1, ...(status === "exited" ? { completed: 2 } : {}) },
  })
  const failed = foldChat(toChat([sh("exited", 1)], false), { running: false, waiting: false })
  expect(failed[0]?.kind === "turn" && failed[0].turn.status).toBe("done")
  const running = toChat([sh("running")], false)
  expect(running.map((m) => m.type)).toEqual(["user", "assistant"])
  const live = foldChat(running, { running: true, waiting: false })
  expect(live[0]?.kind === "turn" && live[0].turn.status).toBe("running")
})

test("only the chat's last request is asked again in place of what followed", () => {
  const messages: SessionMessageInfo[] = [user("u1", "first"), answer("a1", 2), user("u2", "second"), answer("a2", 4)]
  expect(replaceable(messages, false, "u2")).toBe(true)
  // An older request: the later turns would go with it.
  expect(replaceable(messages, false, "u1")).toBe(false)
  // A rewind already staged is settled first.
  expect(replaceable(messages, true, "u2")).toBe(false)
  // A shell command after the request is the person's too.
  const shell = {
    type: "shell",
    id: "s1",
    shellID: "x",
    command: "ls",
    status: "exited",
    time: { created: 5 },
  } as SessionMessageInfo
  expect(replaceable([...messages, shell], false, "u2")).toBe(false)
})

test("the chat's tail tells growth at the end from a page read in above", () => {
  const messages: SessionMessageInfo[] = [user("u2", "second"), answer("a2")]
  const same = tail(messages)
  // An earlier page above changes nothing at the end.
  expect(tail([user("u1", "first"), answer("a1", 2), ...messages])).toBe(same)
  // The answer grew; a tool went from running to done.
  const grown = { ...messages[1]!, content: [{ type: "text", text: "Done and more" }] } as SessionMessageInfo
  expect(tail([messages[0]!, grown])).not.toBe(same)
  expect(tail([...messages, user("u3", "next")])).not.toBe(same)
  expect(tail([])).toBe("")
})
