// Отказ входа в окне подключения (#458): причина — текстом, адрес — на месте, повтор — одним нажатием.
import { expect, test } from "bun:test"
import { signInFailure } from "./sign-in-failure"
import { BuffI18n } from "@opencode/schema/buff-i18n"

const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)

const refused = { _tag: "InvalidRequestError", kind: "integration_authorization", message: "Коннектор не отвечает." }

test("the server's refusal reads as its message, never as [object Object]", () => {
  expect(signInFailure(refused, { address: "https://c.local" }).message).toBe("Коннектор не отвечает.")
  expect(signInFailure(new Error("сеть недоступна"), undefined).message).toBe("сеть недоступна")
})

test("a refusal with nothing to read still says something", () => {
  expect(signInFailure({}, undefined, ru).message).toBe("Не удалось войти. Повторите попытку.")
  expect(signInFailure(undefined, undefined).message).toBe("Could not sign in. Try again.")
})

test("a sign-in that asked for an address goes back to the form with the address kept", () => {
  expect(signInFailure(refused, { connector: "https://c.local" })).toEqual({
    back: "form",
    message: "Коннектор не отвечает.",
    answer: { connector: "https://c.local" },
  })
})

test("a sign-in with no form shows the reason with a retry", () => {
  expect(signInFailure(refused, undefined)).toEqual({ back: "error", message: "Коннектор не отвечает." })
})
