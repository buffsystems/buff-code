import { describe, expect, test } from "bun:test"
import { BuffRequestHeaders } from "../../src/buff/request-headers"

const upstream = {
  "x-session-affinity": "ses_1",
  "X-Session-Id": "ses_1",
  "x-parent-session-id": "ses_0",
  "User-Agent": "buff/latest/2.0.11-buff.19/cli",
  "x-opencode-project": "prj_hash",
  "x-opencode-session": "ses_1",
  "x-opencode-client": "cli",
}

// #510: запрос к модели называет сессию нашими заголовками — по ним шлюз к моделям (#501)
// привязывает расход к сессии; апстримных x-opencode-* наружу больше не уходит.
describe("заголовки запроса к модели", () => {
  test("сессия, родительская сессия и клиент — под именами x-buff-*", () => {
    const out = BuffRequestHeaders.rebrand(upstream, null, true)
    expect(out["X-Buff-Session"]).toBe("ses_1")
    expect(out["X-Buff-Parent-Session"]).toBe("ses_0")
    expect(out["X-Buff-Client"]).toBe("cli")
  })

  test("x-opencode-* не уходят; нейтральные заголовки апстрима остаются", () => {
    const out = BuffRequestHeaders.rebrand(upstream, null, true)
    expect(Object.keys(out).filter((k) => k.toLowerCase().startsWith("x-opencode-"))).toEqual([])
    expect(out["x-session-affinity"]).toBe("ses_1")
    expect(out["X-Session-Id"]).toBe("ses_1")
    expect(out["User-Agent"]).toBe("buff/latest/2.0.11-buff.19/cli")
  })

  test("агент запроса называет Buff Code, а не апстрим", () => {
    const out = BuffRequestHeaders.rebrand({ ...upstream, "User-Agent": "opencode/latest/2.0.11-buff.19/cli" }, null, true)
    expect(out["User-Agent"]).toBe("buff/latest/2.0.11-buff.19/cli")
  })

  test("у корневой сессии родителя нет — заголовка тоже", () => {
    const { ["x-parent-session-id"]: _, ...root } = upstream
    expect(BuffRequestHeaders.rebrand(root, null, true)["X-Buff-Parent-Session"]).toBeUndefined()
  })

  // Раннер (#439): чья это работа, известно из контекста прогона — те же имена, что у
  // сквозной записи в склад.
  test("раннер добавляет контекст прогона", () => {
    const out = BuffRequestHeaders.rebrand(upstream, { org: "acme", project: "shop", issue: 47, atom: 3, role: "coder", phase: "develop" }, true)
    expect(out["X-Buff-Org"]).toBe("acme")
    expect(out["X-Buff-Project"]).toBe("shop")
    expect(out["X-Buff-Issue"]).toBe("47")
    expect(out["X-Buff-Atom"]).toBe("3")
    expect(out["X-Buff-Role"]).toBe("coder")
    expect(out["X-Buff-Phase"]).toBe("develop")
  })

  // Проект апстрима — хеш каталога, а X-Buff-Project — проект организации (его ставит
  // контекст разработчика или раннера). Хеш его не перекрывает.
  test("хеш проекта апстрима не выдаёт себя за проект организации", () => {
    expect(BuffRequestHeaders.rebrand(upstream, null, true)["X-Buff-Project"]).toBeUndefined()
    const set = BuffRequestHeaders.rebrand({ ...upstream, "X-Buff-Project": "shop" }, null, true)
    expect(set["X-Buff-Project"]).toBe("shop")
  })

  // #562: свой провайдер разработчика — не Buff. Ему не уходят ни наши имена сессии и клиента,
  // ни апстримные x-opencode-*; агент запроса — тот же buff/….
  test("своему провайдеру — ни X-Buff-*, ни x-opencode-*", () => {
    const out = BuffRequestHeaders.rebrand(upstream, null, false)
    expect(Object.keys(out).filter((k) => /^x-(buff|opencode)-/i.test(k))).toEqual([])
    expect(out["x-session-affinity"]).toBe("ses_1")
    expect(out["User-Agent"]).toBe("buff/latest/2.0.11-buff.19/cli")
  })

  test("модель Buff — у провайдера buff; у раннера — любая", () => {
    expect(BuffRequestHeaders.toBuff("buff", false)).toBe(true)
    expect(BuffRequestHeaders.toBuff("openrouter", false)).toBe(false)
    expect(BuffRequestHeaders.toBuff("fake", true)).toBe(true)
  })
})
