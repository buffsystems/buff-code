export * as BuffWorkflowService from "./workflow-service.js"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Stream } from "effect"
import type { Scope } from "effect"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Bus } from "../bus.js"
import { KV } from "../kv.js"
import { Permission } from "../permission.js"
import { storage } from "../plugin/host.js"
import { RipgrepBinary } from "../ripgrep/binary.js"
import { BuffLocale } from "./locale.js"
import { Session } from "../session.js"
import { WorkflowActors } from "./workflow/actors.js"
import { WorkflowCompile } from "./workflow/compile.js"
import { WorkflowEngine } from "./workflow/engine.js"
import { WorkflowExecute } from "./workflow/execute.js"
import { WorkflowLibrary } from "./workflow/library.js"
import { WorkflowObserve } from "./workflow/observe.js"
import { WorkflowRuns } from "./workflow/runs.js"
import { WorkflowPolicy } from "./workflow/policy.js"
import { WorkflowSessionPort } from "./workflow/session-port.js"
import { WorkflowSource } from "./workflow/source.js"

/**
 * Служба сценариев (#448) — одна на процесс: сохранённые сценарии у пользователя, прогоны и
 * журнал в KV, двигатель прогонов на настоящих сессиях и наблюдениях за проектом. Окно,
 * консоль и инструменты модели говорят с ней через плагин каталога (`workflow.ts`).
 */

type Args = Readonly<Record<string, unknown>>

const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const sessions = yield* Session.Service
  const global = yield* Global.Service
  const ripgrep = yield* RipgrepBinary.Service
  const library = WorkflowLibrary.make(path.join(global.config, "workflows"))
  const runs = WorkflowRuns.make(storage(kv, "buff.workflow"))
  const promise = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
  const results = WorkflowActors.results()
  let rg: string | undefined
  let sequence = 0
  const script = (id: string) =>
    promise(kv.get(`buff.workflow.script:${id}`)).then((value) => (typeof value === "string" ? value : undefined))
  const engine = WorkflowEngine.make({
    store: {
      putRun: (run) => promise(runs.putRun(run)),
      getRun: (id) => promise(runs.getRun(id)),
      putScript: (id, script) => promise(kv.set(`buff.workflow.script:${id}`, script)),
      getScript: script,
      putActor: (run, actor) => promise(runs.putActor(run, actor)),
      putStep: (run, step) => promise(runs.putStep(run, step)),
      putQuestion: (run, question) => promise(runs.putQuestion(run, question)),
      putArtifact: (run, artifact) => promise(runs.putArtifact(run, artifact)),
      addItem: (run, item) => promise(runs.addItem(run, item)),
      addLog: (run, line) => promise(runs.addLog(run, line)),
      putEntry: (run, key, entry) => promise(runs.putEntry(run, key, entry)),
      journal: (run) => promise(runs.journal(run)),
      items: (run) => promise(runs.detail(run)).then((detail) => detail?.items ?? []),
      artifacts: (run) => promise(runs.detail(run)).then((detail) => detail?.artifacts ?? []),
    },
    sessions: WorkflowSessionPort.make(sessions),
    observe: (directory) => {
      const observe = (rgPath: string) => WorkflowObserve.make({ cwd: directory, rg: rgPath })
      return {
        run: async (op, args) => {
          rg ??= await Effect.runPromise(ripgrep.filepath.pipe(Effect.orElseSucceed(() => "rg")))
          return observe(rg).run(op, args)
        },
      }
    },
    results,
    artifacts: path.join(global.data, "workflow-artifacts"),
    now: () => Date.now(),
    id: () => `wf_${String(Date.now()).padStart(13, "0")}${String(++sequence).padStart(4, "0")}`,
  })
  /** Сессии, где модель прочла руководство: без него скрипты не принимаются (как навык в ZCode). */
  const guided = new Set<string>()
  /** Черновики скриптов — файлы службы: модель правит их и исправляет прогон по пути. */
  const drafts = path.join(global.data, "workflow-drafts")
  const draft = async (text: string) => {
    await mkdir(drafts, { recursive: true })
    const file = path.join(drafts, `${randomUUID()}.ts`)
    await writeFile(file, text)
    return file
  }
  const source = (directory: string): WorkflowSource.Deps => ({
    directory,
    drafts,
    draft,
    read: (file) => readFile(file, "utf8").catch(() => undefined),
    saved: (name) => library.read(name),
  })

  const startSaved = async (input: { name: string; args: Args; directory: string; root?: string }) => {
    const saved = await library.read(input.name)
    if (!saved || !("meta" in saved))
      return {
        problem:
          saved && "problem" in saved
            ? saved.problem
            : BuffLocale.t("There is no workflow «{name}».", { name: input.name }),
      }
    const checked = BuffWorkflowFile.checkArgs(saved.meta.args, input.args)
    if ("problems" in checked) return { problems: checked.problems }
    const compiled = WorkflowCompile.compile(saved.script)
    if (!("js" in compiled)) return { diagnostics: compiled.diagnostics }
    return engine.start({
      compiled,
      script: saved.script,
      scriptPath: await draft(saved.script),
      args: checked.values,
      label: saved.meta.name,
      workflow: saved.meta.name,
      directory: input.directory,
      ...(input.root ? { root: input.root } : {}),
    })
  }

  return {
    library,
    runs,
    engine,
    results,
    guided,
    script,
    drafts,
    source,
    policy: WorkflowPolicy.make(drafts),
    startSaved,
    list: async () => {
      const listed = await library.list()
      const all = await promise(runs.runs())
      return {
        saved: listed.saved.map((item) => {
          const last = all.find((run) => run.workflow === item.meta.name)
          return { ...item, ...(last ? { last: { status: last.status, updated: last.updated, id: last.id } } : {}) }
        }),
        invalid: listed.invalid,
      }
    },
    eval: async (code: string, directory: string) => {
      const compiled = WorkflowCompile.compile(code, { snippet: true })
      if (!("js" in compiled)) return { diagnostics: compiled.diagnostics }
      const logs: string[] = []
      const journal = new Map<string, WorkflowExecute.Entry>()
      const observe = WorkflowObserve.make({
        cwd: directory,
        rg: rg ?? (await Effect.runPromise(ripgrep.filepath.pipe(Effect.orElseSucceed(() => "rg")))),
      })
      const outcome = await WorkflowExecute.execute({
        compiled,
        args: {},
        journal: { get: (key) => journal.get(key), put: (key, entry) => void journal.set(key, entry) },
        host: {
          actor: () => {},
          ask: () => Promise.reject(new Error("A trial snippet has no agents.")),
          cached: () => {},
          observe: (input) => observe.run(input.op, input.args),
          log: (text) => void logs.push(text),
          report: () => {},
          publish: () => Promise.reject(new Error("A trial snippet has no artifacts.")),
          declare: () => {},
        },
      })
      return { outcome, logs }
    },
  }
})

export type Interface = Effect.Success<typeof make> & {
  /** Восстановление после перезапуска — только в управляемой службе (одна на машину). */
  readonly start: Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@buff/WorkflowService") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const service = yield* make
    const bus = yield* Bus.Service
    return Service.of({
      ...service,
      start: Effect.gen(function* () {
        yield* Effect.promise(async () => service.engine.recover(await Effect.runPromise(service.runs.runs())))
        // Актёр ждёт разрешения человека — шаг в ходе прогона «Ждёт разрешения», а не «Идёт».
        yield* Effect.forkScoped(
          bus
            .subscribe([Permission.Event.Asked, Permission.Event.Replied])
            .pipe(
              Stream.runForEach((event) =>
                Effect.promise(() =>
                  service.engine.permission(event.data.sessionID, event.type === "permission.asked"),
                ),
              ),
            ),
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [KV.node, Session.node, Global.node, RipgrepBinary.node, Bus.node],
})
