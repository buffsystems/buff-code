// Что показать при запуске (#401): вход, выбор контекста или ничего — одинаково в терминале,
// десктопе и консоли.
import { expect, test } from "bun:test"
import { launchStep, ownModel, setsUpBuff } from "../src/buff-context-flow.js"

const acme = { org: "acme", project: null, spaces: [] }

test("a chosen context needs nothing at launch", () => {
  expect(launchStep(acme, undefined)).toBe("ready")
})

test("without a sign-in the launch opens the sign-in", () => {
  expect(launchStep(null, { type: "signed_out", message: "…" })).toBe("sign_in")
})

test("signed in but nothing chosen: the organisation and project are asked", () => {
  expect(launchStep(null, undefined)).toBe("choose")
})

test("a connector that does not answer is said as it is, not taken for a missing sign-in", () => {
  expect(launchStep(null, { type: "unreachable", message: "Коннектор компании не ответил" })).toBe("unreachable")
})

test("a context kept from before still needs a sign-in when the sign-in is gone", () => {
  expect(launchStep(acme, { type: "signed_out", message: "…" })).toBe("sign_in")
})

test("a server without Buff at all (no typed refusal) is not a Buff problem: nothing to set up", () => {
  expect(launchStep(null, { message: "not found" })).toBe("absent")
})

test("no organisation at all: the question says why it is empty and what to do (#470)", async () => {
  const { chooseOrg } = await import("../src/buff-context-flow.js")
  const asked: { title: string; empty?: string; count: number }[] = []
  const ask = (async (dialog: { title: string; empty?: string; options: readonly unknown[] }) => {
    asked.push({ title: dialog.title, empty: dialog.empty, count: dialog.options.length })
    return undefined
  }) as Parameters<typeof chooseOrg>[0]
  expect(await chooseOrg(ask, { orgs: [], projects: [], spaces: [] }, null)).toBeUndefined()
  expect(asked).toEqual([
    {
      title: "Organization",
      empty: "You are not in any Buff organization yet. Ask your administrator to add you, then choose again.",
      count: 0,
    },
  ])
})

// #562: вход в Buff не обязателен — разовая команда идёт на своей модели, если она есть.
test("без входа и со своим провайдером настройка Buff пропускается", () => {
  expect(setsUpBuff("sign_in", { connected: true })).toBe(false)
  expect(setsUpBuff("sign_in", { connected: false })).toBe(true)
})

test("модель, названная явно, решает сама: не из Buff — Buff не настраивается", () => {
  for (const step of ["sign_in", "choose"] as const) {
    expect(setsUpBuff(step, { model: "openrouter/qwen", connected: false })).toBe(false)
    expect(setsUpBuff(step, { model: "buff/default", connected: true })).toBe(true)
  }
})

test("со входом, но без контекста, и без явной модели — контекст спрашивается, как раньше", () => {
  expect(setsUpBuff("choose", { connected: true })).toBe(true)
  expect(setsUpBuff("unreachable", { connected: true })).toBe(true)
})

// #562: своя модель — не Buff и не бесплатный уровень OpenCode, видный и без всякого входа.
test("своя модель — любая, кроме Buff и бесплатной OpenCode", () => {
  const free = [{ input: 0 }]
  const paid = [{ input: 1 }]
  expect(ownModel({ providerID: "openrouter", cost: free })).toBe(true)
  expect(ownModel({ providerID: "ollama", cost: [] })).toBe(true)
  expect(ownModel({ providerID: "opencode", cost: paid })).toBe(true)
  expect(ownModel({ providerID: "opencode", cost: free })).toBe(false)
  expect(ownModel({ providerID: "buff", cost: paid })).toBe(false)
})
