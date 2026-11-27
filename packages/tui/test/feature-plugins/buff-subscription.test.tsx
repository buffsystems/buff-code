/** @jsxImportSource @opentui/solid */
// Расход подписки аккаунта Buff в консоли (#966): подпись в строке состояния и что показывает /usage.
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { UsageLabel, usageRows } from "../../src/feature-plugins/buff/subscription"

const color = RGBA.fromInts(200, 200, 200)
const context = {
  theme: { text: { base: color, muted: color, feedback: { warning: { base: color }, error: { base: color } } } },
} as unknown as Context

const now = Date.parse("2026-11-24T10:00:00Z")
const usage = (windows: unknown[], subscription: Record<string, unknown> = {}) =>
  BuffSubscription.usage(
    {
      ok: true,
      subscription: {
        status: "active",
        plan_name: "Базовый",
        plan_name_en: "Basic",
        active_until: "2026-12-24T22:59:59+00:00",
        ...subscription,
      },
      windows,
    },
    "ivan",
  )
const calm = usage([
  { id: "5h", used_pct: 12, reset_at: "2026-11-24T12:30:00Z" },
  { id: "week", used_pct: 5, reset_at: "2026-11-30T00:00:00Z" },
])

async function frame(value: BuffSubscription.Usage | undefined) {
  const app = await testRender(() => <UsageLabel context={context} usage={value} />, { width: 80, height: 1 })
  try {
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("the status line shows the busiest window, short; nothing while it is unknown", async () => {
  expect(await frame(calm)).toContain("5 ч · 12 %")
  expect(
    await frame(
      usage([
        { id: "5h", used_pct: 3, reset_at: null },
        { id: "week", used_pct: 97, reset_at: null },
      ]),
    ),
  ).toContain("неделя · 97 %")
  expect(await frame(usage([], { status: "grace" }))).toContain("закончилась")
  expect((await frame(undefined)).trim()).toBe("")
})

test("/usage: the account, the plan by its name, and each window with its share and reset time", () => {
  expect(usageRows(calm, now)).toEqual([
    { title: "Аккаунт Buff", description: "ivan", value: "row" },
    { title: "Тариф", description: "Базовый · действует до 24.12.2026", value: "row" },
    { title: "Лимит на 5 часов", description: "12 % · обновится через 2 ч 30 мин", value: "row" },
    { title: "Лимит на неделю", description: "5 % · обновится через 5 д 14 ч", value: "row" },
  ])
})

test("/usage without an active subscription says what happened to it", () => {
  const rows = usageRows(usage([], { status: "none", plan_name: null, plan_name_en: null, active_until: null }), now)
  expect(rows).toEqual([
    { title: "Аккаунт Buff", description: "ivan", value: "row" },
    { title: "Тариф", description: "подписки нет", value: "row" },
  ])
  expect(usageRows(usage([], { status: "blocked" }), now)[1]!.description).toBe(
    "Базовый · доступ остановлен — напишите в поддержку",
  )
})

test("a window not started yet has no reset time", () => {
  expect(usageRows(usage([{ id: "5h", used_pct: 0, reset_at: null }]), now)[2]).toEqual({
    title: "Лимит на 5 часов",
    description: "0 %",
    value: "row",
  })
})
