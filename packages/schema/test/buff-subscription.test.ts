// Подписка личного аккаунта Buff (#966): уровни моделей, тариф и окна расхода — как прочитать и сказать.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffSubscription } from "../src/buff-subscription.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const reply = {
  ok: true,
  tiers: [
    {
      id: "fast",
      name: "Быстрая",
      name_en: "Fast",
      context: 200000,
      max_output: 16384,
      input: ["text"],
      output: ["text"],
      tools: true,
    },
    {
      id: "optimal",
      name: "Оптимальная",
      name_en: "Optimal",
      context: null,
      max_output: null,
      input: ["text", "image"],
      output: ["text"],
      tools: true,
    },
    { name: "без идентификатора" },
  ],
  default: "optimal",
  small: "fast",
  subscription: {
    status: "active",
    plan: "plus",
    active_until: "2026-12-01T00:00:00Z",
    plan_name: "Средний",
    plan_name_en: "Plus",
  },
}

describe("уровни моделей подписки", () => {
  test("ответ сервера → уровни: окно и потолок вывода — если сервер их знает", () => {
    const models = BuffSubscription.models(reply)
    expect(models.tiers).toEqual([
      {
        id: "fast",
        name: "Быстрая",
        nameEn: "Fast",
        context: 200000,
        output: 16384,
        input: ["text"],
        outputs: ["text"],
        tools: true,
      },
      {
        id: "optimal",
        name: "Оптимальная",
        nameEn: "Optimal",
        input: ["text", "image"],
        outputs: ["text"],
        tools: true,
      },
    ])
    expect(models.default).toBe("optimal")
    expect(models.small).toBe("fast")
    expect(models.plan).toEqual({
      status: "active",
      name: "Средний",
      nameEn: "Plus",
      activeUntil: "2026-12-01T00:00:00Z",
    })
  })

  test("пределы большого запроса — те, что назвала установка; не назвала или назвала вздор — их нет", () => {
    const request = { max_bytes: 8_388_608, piece_bytes: 783_360, max_pieces: 32, finish_seconds: 120 }
    expect(BuffSubscription.models({ ...reply, request }).request).toEqual({
      maxBytes: 8_388_608,
      pieceBytes: 783_360,
      maxPieces: 32,
      finishSeconds: 120,
    })
    expect(BuffSubscription.models(reply).request).toBeUndefined()
    expect(BuffSubscription.models({ ...reply, request: { ...request, piece_bytes: 0 } }).request).toBeUndefined()
    expect(BuffSubscription.models({ ...reply, request: { max_bytes: "16" } }).request).toBeUndefined()
    // Срок сервер может не назвать: он нужен только для слов.
    expect(BuffSubscription.models({ ...reply, request: { ...request, finish_seconds: null } }).request).toEqual({
      maxBytes: 8_388_608,
      pieceBytes: 783_360,
      maxPieces: 32,
    })
  })

  test("уровень по умолчанию, которого нет в списке, не называется", () => {
    expect(BuffSubscription.models({ ...reply, default: "genius", small: null }).default).toBeNull()
  })

  test("без подписки уровней нет; чужой статус читается как «нет подписки»", () => {
    const none = BuffSubscription.models({
      ok: true,
      tiers: [],
      default: null,
      small: null,
      subscription: { status: "odd" },
    })
    expect(none.tiers).toEqual([])
    expect(none.plan.status).toBe("none")
    expect(BuffSubscription.models(null).plan.status).toBe("none")
  })

  test("имя уровня и тарифа — на языке человека", () => {
    const [fast] = BuffSubscription.models(reply).tiers
    expect(BuffSubscription.tierName(fast!, "ru")).toBe("Быстрая")
    expect(BuffSubscription.tierName(fast!, "en")).toBe("Fast")
    const plan = BuffSubscription.models(reply).plan
    expect(BuffSubscription.planName(plan, "ru")).toBe("Средний")
    expect(BuffSubscription.planName(plan, "en")).toBe("Plus")
    expect(BuffSubscription.planName({ ...plan, nameEn: null }, "en")).toBe("Средний")
    expect(BuffSubscription.planName({ ...plan, name: null, nameEn: null }, "ru")).toBeUndefined()
  })
})

describe("расход подписки", () => {
  const now = Date.parse("2026-11-24T10:00:00Z")
  const usage = BuffSubscription.usage(
    {
      ok: true,
      subscription: reply.subscription,
      windows: [
        { id: "5h", used_pct: 12, reset_at: "2026-11-24T12:30:00Z" },
        { id: "week", used_pct: 95.4, reset_at: null },
        { id: "", used_pct: 1 },
        { id: "month" },
      ],
    },
    "ivan",
  )

  test("ответ сервера → окна; окно без идентификатора или доли не показывается", () => {
    expect(usage.login).toBe("ivan")
    expect(usage.windows).toEqual([
      { id: "5h", usedPct: 12, resetAt: "2026-11-24T12:30:00Z" },
      { id: "week", usedPct: 95, resetAt: null },
    ])
  })

  test("окно, доля и время обновления — словами на обоих языках", () => {
    const [five, week] = usage.windows
    expect(BuffSubscription.windowLabel("5h")).toBe("5-hour limit")
    expect(BuffSubscription.windowLabel("5h", ru)).toBe("Лимит на 5 часов")
    expect(BuffSubscription.windowLabel("week", ru)).toBe("Лимит на неделю")
    expect(BuffSubscription.windowLabel("month", ru)).toBe("month")
    expect(BuffSubscription.usedLabel(five!, ru)).toBe("израсходовано 12 %")
    expect(BuffSubscription.resetLabel(five!, now)).toBe("resets in 2 h 30 min")
    expect(BuffSubscription.resetLabel(five!, now, ru)).toBe("обновится через 2 ч 30 мин")
    expect(BuffSubscription.resetLabel(week!, now, ru)).toBeUndefined()
    expect(BuffSubscription.resetLabel({ ...five!, resetAt: "2026-11-24T10:20:00Z" }, now, ru)).toBe(
      "обновится через 20 мин",
    )
    expect(BuffSubscription.resetLabel({ ...five!, resetAt: "2026-11-27T13:00:00Z" }, now, ru)).toBe(
      "обновится через 3 д 3 ч",
    )
    expect(BuffSubscription.resetLabel({ ...five!, resetAt: "2026-11-24T09:00:00Z" }, now, ru)).toBe(
      "обновится с минуты на минуту",
    )
  })

  test("короткая подпись — самое занятое окно; без действующей подписки — её состояние", () => {
    expect(BuffSubscription.shortLabel(usage, ru)).toBe("неделя · 95 %")
    expect(BuffSubscription.shortLabel(usage)).toBe("week · 95%")
    expect(BuffSubscription.shortLabel({ ...usage, plan: { ...usage.plan, status: "none" } }, ru)).toBe("подписки нет")
    expect(BuffSubscription.shortLabel({ ...usage, windows: [] }, ru)).toBeUndefined()
  })

  test("предупреждение — когда окно почти или совсем исчерпано", () => {
    expect(BuffSubscription.warning({ ...usage, windows: [usage.windows[0]!] }, now, ru)).toBeUndefined()
    expect(BuffSubscription.warning(usage, now, ru)).toBe("Лимит на неделю: израсходовано 95 %.")
    const spent = { ...usage, windows: [{ id: "5h", usedPct: 100, resetAt: "2026-11-24T12:30:00Z" }] }
    expect(BuffSubscription.warning(spent, now, ru)).toBe("Лимит на 5 часов исчерпан — обновится через 2 ч 30 мин.")
    expect(BuffSubscription.warning(spent, now)).toBe("5-hour limit is used up — resets in 2 h 30 min.")
  })

  test("состояние подписки — словами", () => {
    const plan = usage.plan
    expect(BuffSubscription.statusLabel(plan, ru)).toBe("действует")
    expect(BuffSubscription.statusLabel({ ...plan, status: "grace" }, ru)).toBe(
      "закончилась — идёт срок чтения, модели выключены",
    )
    expect(BuffSubscription.statusLabel({ ...plan, status: "blocked" }, ru)).toBe(
      "доступ остановлен — напишите в поддержку",
    )
  })
})
