// Экран «Providers» в Buff Code (#466): подключение — это выполненный вход, а не наличие моделей.
import { expect, test } from "bun:test"
import { accountSignedIn, accountSignInOffered, buffSignedIn, connectedRows, pendingNote, providerTag, signInOffered } from "./providers"

const buff = (connections: { type: string; label?: string }[]) => ({ id: "buff", name: "Buff", connections })

test("a sign-in shows as connected before any context is chosen — so one can sign out", () => {
  expect(connectedRows([], [buff([{ type: "credential" }])])).toEqual([{ id: "buff", name: "Buff", pending: true }])
})

test("the row says whose sign-in it is (#470)", () => {
  expect(connectedRows([], [buff([{ type: "credential", label: "dev-alice · stocks-bot" }])])).toEqual([
    { id: "buff", name: "Buff", pending: true, account: "dev-alice · stocks-bot" },
  ])
  expect(connectedRows([{ id: "buff", name: "Buff" }], [buff([{ type: "credential", label: "anna" }])])).toEqual([
    { id: "buff", name: "Buff", pending: false, account: "anna" },
  ])
})

test("a provider with models is listed once, not twice", () => {
  expect(connectedRows([{ id: "buff", name: "Buff" }], [buff([{ type: "credential" }])])).toEqual([
    { id: "buff", name: "Buff", pending: false },
  ])
})

test("an integration nobody signed in to is not a connection", () => {
  expect(connectedRows([], [buff([])])).toEqual([])
  expect(connectedRows([], [buff([{ type: "env" }])])).toEqual([])
})

test("the sign-in is offered only while there is none", () => {
  expect(signInOffered([buff([])])).toBe(true)
  expect(signInOffered([buff([{ type: "credential" }])])).toBe(false)
  expect(signInOffered([])).toBe(false)
})

// #966: личный аккаунт Buff — отдельный вход рядом со входом компании.
test("the Buff account sign-in is offered while there is none, apart from the company sign-in", () => {
  const account = (connections: { type: string }[]) => ({ id: "buff-account", name: "Аккаунт Buff", connections })
  expect(accountSignInOffered([account([])])).toBe(true)
  expect(accountSignInOffered([account([{ type: "credential" }])])).toBe(false)
  expect(accountSignInOffered([buff([])])).toBe(false)
  expect(signInOffered([account([])])).toBe(false)
  expect(providerTag("buff-account")).toBe("Sign-in with a Buff account")
})

test("whose Buff account is signed in — for the chip and the no-model strip", () => {
  const account = (connections: { type: string; label?: string }[]) => ({ id: "buff-account", name: "Аккаунт Buff", connections })
  expect(accountSignedIn([account([{ type: "credential", label: "ivan" }])])).toBe("ivan")
  expect(accountSignedIn([account([{ type: "credential" }])])).toBe("")
  expect(accountSignedIn([account([])])).toBeUndefined()
  expect(accountSignedIn([buff([{ type: "credential", label: "anna" }])])).toBeUndefined()
})

test("a sign-in without models says why in its own words", () => {
  expect(pendingNote("buff")).toBe("Models will appear after you choose an organization and project")
  expect(pendingNote("buff-account")).toBe("Models will appear when the account has an active subscription")
})

test("Buff is tagged by how one signs in, not as an API key", () => {
  expect(providerTag("buff")).toBe("Sign-in through the connector")
  expect(providerTag("openai")).toBeUndefined()
})

// #457: плашка «нет модели» говорит «войдите», пока входа нет, и «выберите контекст» — после.
test("signed in to Buff is a saved sign-in of the Buff integration", () => {
  expect(buffSignedIn([buff([])])).toBe(false)
  expect(buffSignedIn([buff([{ type: "credential" }])])).toBe(true)
  expect(buffSignedIn([])).toBe(false)
})
