/** @jsxImportSource @opentui/solid */
// Остаток и расход в консоли (#455): подпись в строке состояния и что показывает /balance.
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffBilling } from "@opencode/schema/buff-billing"
import { BalanceLabel, balanceRows, sessionBalance } from "../../src/feature-plugins/buff/billing"

const color = RGBA.fromInts(200, 200, 200)
const context = {
  theme: { text: { base: color, muted: color, feedback: { warning: { base: color }, error: { base: color } } } },
} as unknown as Context

const info = (over: Record<string, unknown> = {}) =>
  BuffBilling.fromReply({
    billing: {
      org: "acme",
      balance_rub: 1234.5,
      days_left: 12.4,
      low: false,
      exhausted: false,
      tariff: "Команда",
      price_input_rub_per_m: 90,
      price_output_rub_per_m: 180,
      mine: {
        window_days: 3,
        total_rub: 150,
        days: [
          { day: "2026-10-01", rub: 100 },
          { day: "2026-10-03", rub: 50 },
        ],
      },
      cabinet_url: "https://dev.example/app",
      ...over,
    },
  })!

async function frame(value: BuffBilling.Info | undefined) {
  const app = await testRender(() => <BalanceLabel context={context} info={value} />, { width: 80, height: 1 })
  try {
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("the balance is shown in the status line, short; nothing while it is unknown", async () => {
  expect(await frame(info())).toContain("1 234,50 ₽")
  expect(await frame(info({ low: true, days_left: 2.2 }))).toContain("1 234,50 ₽ · ≈ 2 дн.")
  // Закончились — сумма красным, а словами говорит предупреждение: строка состояния узкая.
  expect(await frame(info({ balance_rub: -14.82, exhausted: true, days_left: 0 }))).toContain("−14,82 ₽")
  expect((await frame(undefined)).trim()).toBe("")
})

test("under a session the balance shows only when it matters — the line is narrow there", () => {
  expect(sessionBalance(info())).toBeUndefined()
  expect(sessionBalance(info({ low: true, days_left: 2.2 }))).toBeDefined()
  expect(sessionBalance(info({ balance_rub: 0, exhausted: true, days_left: 0 }))).toBeDefined()
  expect(sessionBalance(undefined)).toBeUndefined()
})

test("/balance lists the balance, the tariff, this session, my spend by day and the cabinet", () => {
  const rows = balanceRows(info(), "2026-10-03", "≈ 171 ₽")
  expect(rows.map((row) => [row.title, row.description])).toEqual([
    ["Остаток acme", "1 234,50 ₽"],
    ["Хватит при текущем расходе", "≈ 12 дн."],
    ["Тариф", "Команда"],
    ["Цена за 1 млн токенов", "вход 90 ₽ · выход 180 ₽"],
    ["Эта сессия (оценка)", "≈ 171 ₽"],
    ["Мой расход за 3 дня", "150 ₽"],
    ["  03.10", "50 ₽"],
    ["  02.10", "0 ₽"],
    ["  01.10", "100 ₽"],
    ["Открыть кабинет", "https://dev.example/app"],
  ])
  expect(rows.at(-1)!.value).toBe("cabinet")
})

test("without a session, a tariff or prices those rows say so; funds gone — the balance says it", () => {
  const rows = balanceRows(info({ tariff: null, price_input_rub_per_m: null }), "2026-10-03", undefined)
  expect(rows.map((row) => row.title)).not.toContain("Эта сессия (оценка)")
  expect(rows.find((row) => row.title === "Тариф")!.description).toBe("не назначен")
  expect(rows.find((row) => row.title === "Цена за 1 млн токенов")!.description).toBe("не задана")
  const gone = balanceRows(info({ balance_rub: -14.82, exhausted: true, days_left: 0 }), "2026-10-03", undefined)
  expect(gone[0]).toMatchObject({ description: "−14,82 ₽ · закончились" })
  expect(gone.map((row) => row.title)).not.toContain("Хватит при текущем расходе")
})
