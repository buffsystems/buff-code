// Сценарии (#448): исполнение в песочнице, фазы шагов, журнал — повтор без повторной оплаты, остановка.
import { describe, expect, test } from "bun:test"
import { WorkflowCompile } from "../../src/buff/workflow/compile"
import { WorkflowExecute } from "../../src/buff/workflow/execute"

function compiled(script: string) {
  const result = WorkflowCompile.compile(script)
  if (!("js" in result)) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function world() {
  const asks: { actor: string; instructions: string; phase?: string; schema?: unknown }[] = []
  const cached: string[] = []
  const logs: string[] = []
  const reports: unknown[] = []
  const store = new Map<string, WorkflowExecute.Entry>()
  let gate: Promise<void> | undefined
  const host: Mutable<WorkflowExecute.Host> = {
    actor: () => {},
    ask: async (input) => {
      asks.push({ actor: input.actor.key, instructions: input.instructions, phase: input.phase, schema: input.schema })
      if (gate) await gate
      return input.schema ? { ok: true, about: input.instructions } : `ответ на «${input.instructions}»`
    },
    cached: (input) => void cached.push(input.instructions),
    observe: async (input) =>
      input.op === "files.glob" ? ["a.ts", "b.ts"] : { exitCode: 0, stdout: "ok", stderr: "" },
    log: (text) => void logs.push(text),
    report: (item) => void reports.push(item),
    publish: async (input) => ({ id: input.id, version: 1 }),
    declare: () => {},
  }
  const journal: WorkflowExecute.Journal = {
    get: (key) => store.get(key),
    put: (key, entry) => void store.set(key, entry),
  }
  return { host, journal, asks, cached, logs, reports, store, hold: (p: Promise<void>) => void (gate = p) }
}

const script = `interface Verdict { ok: boolean; about: string }
phase("Собрать")
const files_ = await files.glob("**/*.ts")
await world.run("git", ["status"])
log("файлов: " + files_.length)
phase("Проверить")
const verdicts = await Promise.all(files_.map(async (file) => {
  await world.run("bun", ["test", file])
  return agent("проверка-" + file).ask<Verdict>("Проверь " + file)
}))
report({ files: files_.length })
const summary = await agent("итог").ask("Сведи " + verdicts.length)
return { summary, ok: verdicts.every((v) => v.ok) }
`

describe("running a workflow", () => {
  test("steps run with their phases and schemas; the return value is the result", async () => {
    const w = world()
    const outcome = await WorkflowExecute.execute({
      compiled: compiled(script),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    expect(outcome).toEqual({ status: "completed", result: { summary: "ответ на «Сведи 2»", ok: true } })
    expect(w.asks.map((a) => [a.actor, a.phase])).toEqual([
      ["проверка-a.ts", "Проверить"],
      ["проверка-b.ts", "Проверить"],
      ["итог", "Проверить"],
    ])
    expect(w.asks[0]!.schema).toMatchObject({ type: "object", required: ["ok", "about"] })
    expect(w.logs).toEqual(["файлов: 2"])
    expect(w.reports).toEqual([{ files: 2 }])
  })

  test("run again on the same journal — nothing is asked twice, the same result", async () => {
    const w = world()
    const first = await WorkflowExecute.execute({
      compiled: compiled(script),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    const before = w.asks.length
    const second = await WorkflowExecute.execute({
      compiled: compiled(script),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    expect(second).toEqual(first)
    expect(w.asks.length).toBe(before)
    expect(w.cached).toEqual(["Проверь a.ts", "Проверь b.ts", "Сведи 2"])
    expect(w.reports).toEqual([{ files: 2 }])
    expect(w.logs).toEqual(["файлов: 2"])
  })

  test("asks on one actor queue in order", async () => {
    const w = world()
    const order: string[] = []
    w.host.ask = async (input) => {
      order.push("start " + input.instructions)
      await new Promise((r) => setTimeout(r, 10))
      order.push("end " + input.instructions)
      return "x"
    }
    await WorkflowExecute.execute({
      compiled: compiled('phase("Шаг")\nconst a = agent("a")\nawait Promise.all([a.ask("1"), a.ask("2")])'),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"])
  })

  test("arguments arrive as given", async () => {
    const w = world()
    const outcome = await WorkflowExecute.execute({
      compiled: compiled('phase("Шаг")\nawait agent("a").ask("x")\nreturn String(args.target) + args.depth'),
      args: { target: "src", depth: 2 },
      host: w.host,
      journal: w.journal,
    })
    expect(outcome).toEqual({ status: "completed", result: "src2" })
  })

  test("a script error is an error of the script, in words", async () => {
    const w = world()
    const outcome = await WorkflowExecute.execute({
      compiled: compiled(
        'phase("Шаг")\nawait agent("a").ask("x")\nconst list: string[] = []\nif (list.length === 0) throw new Error("пусто")',
      ),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    expect(outcome).toEqual({ status: "errored", error: "пусто" })
  })

  test("stopped — the script does not see it, the run stops", async () => {
    const w = world()
    let release!: () => void
    w.hold(new Promise((r) => (release = r)))
    const controller = new AbortController()
    const running = WorkflowExecute.execute({
      compiled: compiled('phase("Шаг")\ntry { await agent("a").ask("x") } catch { return "поймал" }\nreturn "дошёл"'),
      args: {},
      host: w.host,
      journal: w.journal,
      signal: controller.signal,
    })
    await new Promise((r) => setTimeout(r, 20))
    controller.abort("user")
    expect(await running).toEqual({ status: "stopped", reason: "user" })
    release()
  })

  test("a provider stop stops the run, not the script", async () => {
    const w = world()
    w.host.ask = async () => {
      throw new WorkflowExecute.ProviderStop("Недостаточно средств")
    }
    const outcome = await WorkflowExecute.execute({
      compiled: compiled('phase("Шаг")\ntry { await agent("a").ask("x") } catch { return "поймал" }'),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    expect(outcome).toEqual({ status: "stopped", reason: "provider", error: "Недостаточно средств" })
  })

  test("the sandbox has no host: no process, require, fetch, and no way out through the facade", async () => {
    const w = world()
    const outcome = await WorkflowExecute.execute({
      compiled: compiled(
        'phase("Шаг")\nawait agent("a").ask("x")\nconst g = globalThis as any\nconst out = (log as any).constructor.constructor("return typeof process")()\nreturn [typeof g.process, typeof g.require, typeof g.fetch, typeof g.Bun, out]',
      ),
      args: {},
      host: w.host,
      journal: w.journal,
    })
    expect(outcome).toEqual({
      status: "completed",
      result: ["undefined", "undefined", "undefined", "undefined", "undefined"],
    })
  })
})

describe("amending a run", () => {
  test("named actors' finished work carries over; changed instructions and anonymous actors are asked again", async () => {
    const w = world()
    const before =
      'phase("Шаг")\nconst a = await agent("анализ").ask("Разбери")\nconst b = await agent().ask("Без имени")\nreturn a + b'
    await WorkflowExecute.execute({ compiled: compiled(before), args: {}, host: w.host, journal: w.journal })
    const carried = new Map(WorkflowExecute.carried(w.store))
    const next = world()
    const journal: WorkflowExecute.Journal = {
      get: (key) => carried.get(key),
      put: (key, entry) => void carried.set(key, entry),
    }
    const after = before.replace("return a + b", 'const c = await agent("итог").ask("Сведи")\nreturn a + b + c')
    await WorkflowExecute.execute({ compiled: compiled(after), args: {}, host: next.host, journal })
    expect(next.cached).toEqual(["Разбери"])
    expect(next.asks.map((a) => a.instructions)).toEqual(["Без имени", "Сведи"])
  })
})

describe("a snippet — the test bench", () => {
  test("no phases needed; no agents; the result and logs come back", async () => {
    const result = WorkflowCompile.compile(
      'const list = await files.glob("*.ts")\nlog("нашёл " + list.length)\nreturn list',
      {
        snippet: true,
      },
    )
    if (!("js" in result)) throw new Error(JSON.stringify(result.diagnostics))
    const w = world()
    expect(await WorkflowExecute.execute({ compiled: result, args: {}, host: w.host, journal: w.journal })).toEqual({
      status: "completed",
      result: ["a.ts", "b.ts"],
    })
    expect(w.logs).toEqual(["нашёл 2"])
    const refused = WorkflowCompile.compile('await agent("a").ask("x")', { snippet: true })
    expect(refused.diagnostics.map((d) => d.message)).toContain(
      "A trial snippet has no agent() or report(): only observations and logic.",
    )
  })
})
