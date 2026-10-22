// Сценарии (#448): прогон целиком — запуск, итог в сессию, остановка, продолжение, исправление, вопросы.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WorkflowActors } from "../../src/buff/workflow/actors"
import { WorkflowCompile } from "../../src/buff/workflow/compile"
import { WorkflowEngine } from "../../src/buff/workflow/engine"

const compiled = (script: string) => {
  const result = WorkflowCompile.compile(script)
  if (!("js" in result)) throw new Error(JSON.stringify(result.diagnostics))
  return result
}
const tokens = { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }

function world() {
  const notes: { session: string; text: string }[] = []
  const interrupted: string[] = []
  const prompts: { session: string; text: string }[] = []
  const records = new Map<string, unknown>()
  const journals = new Map<string, Map<string, unknown>>()
  let counter = 0
  let hold: Promise<void> | undefined
  const results = WorkflowActors.results()
  const engine = WorkflowEngine.make({
    store: {
      putRun: async (run) => void records.set("run:" + run.id, run),
      getRun: async (id) => records.get("run:" + id) as never,
      putScript: async (id, script) => void records.set("script:" + id, script),
      getScript: async (id) => records.get("script:" + id) as string | undefined,
      putActor: async () => {},
      putStep: async (run, step) => void records.set(`step:${run}:${step.id}`, step),
      putQuestion: async (run, question) => void records.set(`q:${run}:${question.id}`, question),
      putArtifact: async (run, artifact) => void records.set(`art:${run}:${artifact.id}`, artifact),
      addItem: async () => {},
      addLog: async () => {},
      putEntry: async (run, key, entry) => {
        const journal = journals.get(run) ?? new Map()
        journal.set(key, entry)
        journals.set(run, journal)
      },
      journal: async (run) => new Map((journals.get(run) ?? new Map()) as Map<string, never>),
      items: async () => [],
      artifacts: async () => [],
    },
    sessions: {
      create: async () => "ses_" + ++counter,
      createRoot: async () => "ses_root_ui",
      prompt: async (input) => {
        prompts.push(input)
        if (hold) await hold
        return { message: "m" + prompts.length }
      },
      wait: async () => {},
      state: async () => ({ outcome: "succeeded", tokens }),
      lastText: async () => "готово",
      diff: async () => [],
      synthetic: async (session, text) => void notes.push({ session, text }),
      interrupt: async (session) => void interrupted.push(session),
    },
    observe: () => ({ run: async () => ["a.ts"] }),
    results,
    artifacts: mkdtempSync(path.join(tmpdir(), "wf-art-")),
    now: () => 1,
    id: () => "wf" + ++counter,
  })
  const run = (id: string) =>
    records.get("run:" + id) as {
      status: string
      stopReason?: string
      supersededBy?: string
      metrics: { tokens: { total: number } }
    }
  return {
    engine,
    notes,
    interrupted,
    prompts,
    run,
    records,
    hold: (p: Promise<void> | undefined) => void (hold = p),
    results,
  }
}

const settled = (engine: WorkflowEngine.Engine, id: string) => engine.settled(id)
const script =
  'phase("Шаг")\nconst a = await agent("a").ask("раз")\nconst b = await agent("b").ask("два")\nreturn a + b'

describe("a run", () => {
  test("started from chat: runs, settles, the session gets the result", async () => {
    const w = world()
    const started = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      root: "ses_chat",
    })
    await settled(w.engine, started.run)
    expect(w.run(started.run)).toMatchObject({ status: "completed" })
    expect(w.run(started.run).metrics.tokens.total).toBe(0)
    expect(w.notes[0]).toMatchObject({ session: "ses_chat" })
    expect(w.notes[0]!.text).toContain("готовоготово")
  })
  test("the run remembers its script file; an amended run — the revised one", async () => {
    const w = world()
    const first = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      root: "ses_chat",
      scriptPath: "/d/a.ts",
    })
    await settled(w.engine, first.run)
    expect(w.run(first.run)).toMatchObject({ scriptPath: "/d/a.ts" })
    const amended = await w.engine.amend(first.run, { compiled: compiled(script), scriptPath: "/d/b.ts" })
    await settled(w.engine, amended.run!)
    expect(w.run(amended.run!)).toMatchObject({ scriptPath: "/d/b.ts" })
  })
  test("started from the list: a new session in the project", async () => {
    const w = world()
    const started = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      workflow: "probe",
    })
    expect(started.session).toBe("ses_root_ui")
    await settled(w.engine, started.run)
    expect(w.notes[0]!.session).toBe("ses_root_ui")
  })
  test("stopped: actor sessions are interrupted, the run is stopped by the user; resumed — finished work is not asked again", async () => {
    const w = world()
    let release!: () => void
    w.hold(new Promise((r) => (release = r)))
    const started = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      root: "ses_chat",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(await w.engine.stop(started.run)).toBe(true)
    expect(w.run(started.run)).toMatchObject({ status: "stopped", stopReason: "user" })
    expect(w.interrupted.length).toBe(1)
    w.hold(undefined)
    release()
    await new Promise((r) => setTimeout(r, 20))
    const asked = w.prompts.length
    expect(await w.engine.resume(started.run)).toEqual({})
    expect(w.run(started.run)).toMatchObject({ started: 1, spent: 0 })
    await settled(w.engine, started.run)
    expect(w.run(started.run)).toMatchObject({ status: "completed" })
    expect(w.prompts.length).toBe(asked + 1)
  })
  test("amended: a new run supersedes the old one and reuses named actors' work", async () => {
    const w = world()
    const first = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      root: "ses_chat",
    })
    await settled(w.engine, first.run)
    const asked = w.prompts.length
    const amended = await w.engine.amend(first.run, {
      compiled: compiled(script.replace("return a + b", 'const c = await agent("c").ask("три")\nreturn a + b + c')),
    })
    const next = amended.run
    if (!next) throw new Error("no run")
    await settled(w.engine, next)
    expect(w.run(first.run)).toMatchObject({ status: "stopped", stopReason: "superseded", supersededBy: next })
    expect(w.prompts.length).toBe(asked + 1)
  })
  test("a question from an actor reaches the session; the answer goes back", async () => {
    const w = world()
    const started = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      root: "ses_chat",
    })
    await new Promise((r) => setTimeout(r, 5))
    const pending = w.engine.question("ses_" + 2, "Какую ветку?")
    await new Promise((r) => setTimeout(r, 5))
    const asked = w.notes.find((note) => note.text.includes("Какую ветку?"))
    expect(asked?.session).toBe("ses_chat")
    const id = /question_id: "([^"]+)"/.exec(asked!.text)?.[1] ?? ""
    expect(await w.engine.answer(id, "main")).toEqual({})
    expect(await pending).toBe("main")
    await settled(w.engine, started.run)
  })
  test("a command the script runs is a step of its phase, with its exit code and output", async () => {
    const w = world()
    const started = await w.engine.start({
      compiled: compiled('phase("Проверка")\nconst r = await world.run("ls", ["-1"])\nreturn r'),
      args: {},
      label: "Команда",
      directory: "/p",
      root: "ses_chat",
    })
    await settled(w.engine, started.run)
    const steps = [...w.records.entries()]
      .filter(([key]) => key.startsWith(`step:${started.run}:`))
      .map(([, step]) => step)
    expect(steps).toEqual([
      expect.objectContaining({
        actor: "$ ls",
        phase: "Проверка",
        instructions: "ls -1",
        status: "done",
        result: ["a.ts"],
      }),
    ])
  })
  test("an actor asking for permission: its step waits for it, then goes on", async () => {
    const w = world()
    let release!: () => void
    w.hold(new Promise((r) => (release = r)))
    const started = await w.engine.start({
      compiled: compiled(script),
      args: {},
      label: "Проба",
      directory: "/p",
      root: "ses_chat",
    })
    await new Promise((r) => setTimeout(r, 10))
    const status = () =>
      [...w.records.entries()]
        .filter(([key]) => key.startsWith(`step:${started.run}:`))
        .map(([, step]) => (step as { status: string }).status)
    await w.engine.permission("ses_2", true)
    expect(status()).toEqual(["approval"])
    await w.engine.permission("ses_2", false)
    expect(status()).toEqual(["running"])
    await w.engine.permission("ses_unknown", true)
    w.hold(undefined)
    release()
    await settled(w.engine, started.run)
  })
  test("on boot, runs left running by a dead process are interrupted — resumable", async () => {
    const w = world()
    await w.engine.recover([{ id: "old", status: "running" } as never])
    expect(w.run("old")).toMatchObject({ status: "stopped", stopReason: "interrupted" })
  })
})
