import { expect, test } from "bun:test"
import type { SshItem } from "@opencode/app/ssh"
import { createStore } from "../../core/store"
import { createSshController } from "./controller"

const config = { id: "a", target: "me@host", name: "" }
const item = (stage: SshItem["stage"], extra: Partial<SshItem> = {}): SshItem => ({
  config,
  saved: true,
  stage,
  detail: "",
  ...extra,
})

test("an attempt asks for its prompt once and calls back when the host is ready", async () => {
  const items = createStore<readonly SshItem[]>([item("disconnected")])
  const calls: string[] = []
  const connected: string[] = []
  const ssh = createSshController({
    items,
    api: {
      start: async () => void calls.push("start"),
      respond: async (_id, prompt, value) => void calls.push(`respond:${prompt}:${value}`),
      cancel: async () => undefined,
      disconnect: async () => undefined,
      forget: async () => undefined,
    },
    refresh: async () => items.set(() => [item("connecting")]),
    error: () => calls.push("error"),
  })
  ssh.connect(config, { onConnected: () => connected.push("a") })
  await new Promise((resolve) => setTimeout(resolve, 0))
  items.set(() => [item("authentication", { prompt: { id: "p1", text: "Password:", confirm: false } })])
  expect(ssh.next()?.config.id).toBe("a")
  ssh.opened("a")
  expect(ssh.next()).toBeUndefined()
  ssh.respond("a", "p1", "secret")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(ssh.answered("a")).toBe(true)
  items.set(() => [item("ready")])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).toEqual(["start", "respond:p1:secret"])
  expect(connected).toEqual(["a"])
  expect(ssh.attempts.get().a?.active).toBe(false)
})

test("a failed start reports once when no prompt was shown", async () => {
  const items = createStore<readonly SshItem[]>([item("disconnected")])
  const errors: string[] = []
  const ssh = createSshController({
    items,
    api: {
      start: async () => Promise.reject(new Error("no")),
      respond: async () => undefined,
      cancel: async () => undefined,
      disconnect: async () => undefined,
      forget: async () => undefined,
    },
    refresh: async () => undefined,
    error: () => errors.push("error"),
  })
  ssh.connect(config)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(errors).toEqual(["error"])
  expect(ssh.error("a")).toBe(true)
})
