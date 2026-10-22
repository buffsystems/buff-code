// Сбой создания сессии не теряет набранное (#458): черновик становится сессией только после
// того, как служба её создала.
import { expect, test } from "bun:test"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { sessionCreated, sessionCreateFailure } from "./session-create"

const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)

test("a created session lets the draft go on", async () => {
  const undone: string[] = []
  expect(await sessionCreated(Promise.resolve({ ok: true }), async () => void undone.push("rollback"))).toBe(true)
  expect(undone).toEqual([])
})

test("a session that was not created stops the draft where it is and undoes what was prepared", async () => {
  const undone: string[] = []
  expect(await sessionCreated(Promise.resolve({ ok: false }), async () => void undone.push("rollback"))).toBe(false)
  expect(undone).toEqual(["rollback"])
})

test("the failure says why, and that the message is still there", () => {
  expect(sessionCreateFailure({ message: "disk is full" }, ru)).toBe(
    "disk is full. Сообщение осталось в поле ввода — отправьте его ещё раз.",
  )
})

test("in English the same failure reads in English", () => {
  expect(sessionCreateFailure(undefined)).toBe(
    "The local Buff Code service returned an error. The message is still in the input box — send it again.",
  )
})

test("a failure with nothing readable still says what happened", () => {
  for (const error of [new Error("UnexpectedStatus"), {}, undefined])
    expect(sessionCreateFailure(error, ru)).toBe(
      "Локальная служба Buff Code ответила ошибкой. Сообщение осталось в поле ввода — отправьте его ещё раз.",
    )
})
