// Первый запуск (#457): что сказать, когда модели нет, сколько живёт код входа, шаги знакомства.
import { describe, expect, test } from "bun:test"
import { BuffFirstRun } from "../src/buff-first-run.js"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffLinks } from "../src/buff-links.js"

// #472: строки схемы — английские исходные; ожидания — по-русски, через общий каталог.
const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)
const local = (state: BuffFirstRun.NoModel | undefined) => state && { ...state, text: ru(state.text) }

describe("no model", () => {
  test("not signed in — sign in", () => {
    expect(local(BuffFirstRun.noModel({ signedIn: false, context: false, models: false, own: false }))).toEqual({
      text: "Нет модели — войдите в Buff или подключите свой провайдер.",
      action: "sign-in",
    })
  })
  test("signed in without a context — choose the organisation and project", () => {
    expect(local(BuffFirstRun.noModel({ signedIn: true, context: false, models: false, own: false }))).toEqual({
      text: "Нет модели — выберите организацию и проект Buff.",
      action: "choose-context",
    })
  })
  test("signed in with a context but no models yet — say what to check", () => {
    expect(local(BuffFirstRun.noModel({ signedIn: true, context: true, models: false, own: false }))).toEqual({
      text: "Модели организации не загрузились — проверьте связь с коннектором компании или выберите контекст заново.",
      action: "choose-context",
    })
  })
  test("the console's status line says it short", () => {
    expect(ru(BuffFirstRun.SIGNED_OUT_SHORT)).toBe("нет модели — войдите в Buff или подключите провайдер · /connect")
  })
  // #562: своя модель — тоже модель; Buff тогда не обязателен.
  test("an own provider's model is there — nothing to say, signed in or not", () => {
    expect(BuffFirstRun.noModel({ signedIn: false, context: false, models: false, own: true })).toBeUndefined()
    expect(BuffFirstRun.noModel({ signedIn: true, context: false, models: false, own: true })).toBeUndefined()
  })
  test("models are there — nothing to say", () => {
    expect(BuffFirstRun.noModel({ signedIn: true, context: true, models: true, own: false })).toBeUndefined()
  })
})

describe("the sign-in code", () => {
  test("how long it still holds, mm:ss", () => {
    expect(BuffFirstRun.codeLeft(600_000, 18_000)).toBe("9:42")
    expect(BuffFirstRun.codeLeft(600_000, 595_500)).toBe("0:05")
  })
  test("an expired code says so", () => {
    expect(BuffFirstRun.codeLeft(600_000, 600_000)).toBeUndefined()
    expect(BuffFirstRun.codeLeft(600_000, 700_000)).toBeUndefined()
  })
  test("where to get the connector address — the sign-in page of the docs", () => {
    expect(ru(BuffFirstRun.CONNECTOR_HINT)).toContain("администратор")
    expect(BuffLinks.signIn).toBe("https://buff.systems/docs/buff-code/sign-in")
  })
})

describe("the introduction", () => {
  test("three steps, each with a real effect", () => {
    expect(BuffFirstRun.STEPS.map((step) => ru(step.title))).toEqual([
      "Чем вы занимаетесь?",
      "Как будет выглядеть Buff Code?",
      "Что включить?",
    ])
  })
  test("the kind of work sets the permission mode and whether new sessions start in Plan", () => {
    expect(BuffFirstRun.ROLES.map((role) => [role.value, role.mode, role.plan])).toEqual([
      ["develop", "edit", false],
      ["review", "ask", true],
      ["documents", "ask", false],
    ])
  })
  test("themes are the three the interface has", () => {
    expect(BuffFirstRun.THEMES.map((theme) => theme.value)).toEqual(["system", "light", "dark"])
  })
})

// #472: у каждой строки знакомства и входа есть русский перевод.
test("every first-run string has a Russian translation", () => {
  const texts = [
    BuffFirstRun.SIGNED_OUT_SHORT,
    BuffFirstRun.SIGNED_OUT_OWN,
    BuffFirstRun.CONNECTOR_HINT,
    BuffFirstRun.CODE_EXPIRED,
    ...BuffFirstRun.STEPS.flatMap((step) => [step.title, step.note]),
    ...BuffFirstRun.ROLES.flatMap((role) => [role.title, role.note]),
    ...BuffFirstRun.THEMES.map((theme) => theme.title),
    BuffFirstRun.MEMORY.title,
    BuffFirstRun.MEMORY.note,
    BuffFirstRun.ASK_FIRST.title,
    BuffFirstRun.ASK_FIRST.note,
  ]
  for (const text of texts) expect(ru(text)).not.toBe(text)
})
