export * as WorkflowEngine from "./engine.js"

import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { WorkflowActors } from "./actors.js"
import { WorkflowCompile } from "./compile.js"
import { WorkflowExecute } from "./execute.js"
import { WorkflowNotify } from "./notify.js"

/**
 * Прогоны сценариев (#448): запуск (из чата — в его сессии, из списка — в новой сессии проекта),
 * итог и вопросы актёров — сообщением в эту сессию, остановка с прерыванием сессий актёров,
 * продолжение по журналу, исправленный прогон с переносом работы именованных актёров, артефакты,
 * метрики прогона суммой шагов. Хранилище, сессии и наблюдения — внедряются.
 */

type Item = { readonly value: unknown; readonly artifact?: string }

export interface Store {
  readonly putRun: (run: BuffWorkflow.Run) => Promise<void>
  readonly getRun: (id: string) => Promise<BuffWorkflow.Run | undefined>
  readonly putScript: (id: string, script: string) => Promise<void>
  readonly getScript: (id: string) => Promise<string | undefined>
  readonly putActor: (run: string, actor: BuffWorkflow.Actor) => Promise<void>
  readonly putStep: (run: string, step: BuffWorkflow.Step) => Promise<void>
  readonly putQuestion: (run: string, question: BuffWorkflow.Question) => Promise<void>
  readonly putArtifact: (run: string, artifact: BuffWorkflow.Artifact) => Promise<void>
  readonly addItem: (run: string, item: Item) => Promise<void>
  readonly addLog: (run: string, line: { readonly at: number; readonly text: string }) => Promise<void>
  readonly putEntry: (run: string, key: string, entry: WorkflowExecute.Entry) => Promise<void>
  readonly journal: (run: string) => Promise<Map<string, WorkflowExecute.Entry>>
  readonly items: (run: string) => Promise<readonly Item[]>
  readonly artifacts: (run: string) => Promise<readonly BuffWorkflow.Artifact[]>
}

export interface Sessions extends WorkflowActors.Sessions {
  readonly createRoot: (input: { directory: string; title: string }) => Promise<string>
  /** Отметка в сессии: текст — модели, `summary` — человеку рядом с «Сценарий» (#711). */
  readonly synthetic: (session: string, text: string, summary: string) => Promise<void>
  readonly interrupt: (session: string) => Promise<void>
}

export interface Start {
  readonly compiled: WorkflowCompile.Compiled
  readonly script?: string
  readonly args: Readonly<Record<string, unknown>>
  readonly label: string
  readonly directory: string
  readonly workflow?: string
  /** Сессия, из которой запущено (из чата); без неё — новая сессия в проекте. */
  readonly root?: string
  readonly scriptPath?: string
}

interface Live {
  readonly run: BuffWorkflow.Run
  readonly compiled: WorkflowCompile.Compiled
  readonly controller: AbortController
  readonly sessions: Map<string, string>
  readonly steps: Map<string, BuffWorkflow.Step>
  readonly done: Promise<void>
}

export function make(deps: {
  readonly store: Store
  readonly sessions: Sessions
  readonly observe: (directory: string) => { readonly run: (op: string, args: readonly unknown[]) => Promise<unknown> }
  readonly results: WorkflowActors.Results
  /** Каталог, куда копируются опубликованные файлы. */
  readonly artifacts: string
  readonly now: () => number
  readonly id: () => string
}) {
  const live = new Map<string, Live>()
  const bySession = new Map<string, { run: string; actor: string }>()
  const questions = new Map<string, { run: string; resolve: (text: string) => void; question: BuffWorkflow.Question }>()
  const versions = new Map<string, number>()
  const runs = new Map<string, BuffWorkflow.Run>()
  /** Скомпилированный скрипт прогона — и после остановки: продолжению не нужно компилировать заново. */
  const programs = new Map<string, WorkflowCompile.Compiled>()

  const save = async (run: BuffWorkflow.Run) => {
    runs.set(run.id, run)
    await deps.store.putRun(run)
  }
  const current = async (id: string) => runs.get(id) ?? (await deps.store.getRun(id))

  const execute = async (
    run: BuffWorkflow.Run,
    compiled: WorkflowCompile.Compiled,
    journal: Map<string, WorkflowExecute.Entry>,
  ) => {
    programs.set(run.id, compiled)
    const controller = new AbortController()
    const sessions = new Map<string, string>()
    const steps = new Map<string, BuffWorkflow.Step>()
    const observe = deps.observe(run.directory)
    const record = (step: BuffWorkflow.Step) => {
      steps.set(step.id, step)
      void deps.store.putStep(run.id, step)
      const latest = runs.get(run.id)
      if (latest)
        void save({
          ...latest,
          updated: deps.now(),
          metrics: BuffWorkflow.sum([...steps.values()].map((item) => item.metrics)),
        })
    }
    const actorSessions: WorkflowActors.Sessions = {
      ...deps.sessions,
      create: async (input) => {
        const session = await deps.sessions.create(input)
        const actor = (input.metadata.buffWorkflow as { actor: string }).actor
        sessions.set(actor, session)
        bySession.set(session, { run: run.id, actor })
        void deps.store.putActor(run.id, { key: actor, session, ...(actor.startsWith("#") ? {} : { name: actor }) })
        return session
      },
    }
    const ask = WorkflowActors.make({
      run: { id: run.id, label: run.label, root: run.session ?? "", directory: run.directory },
      sessions: actorSessions,
      results: deps.results,
      now: deps.now,
      step: record,
      progress: (id, metrics) => {
        const step = steps.get(id)
        if (step && step.finished === undefined) record({ ...step, metrics })
      },
    })
    let commands = 0
    /** Команда сценария — шаг своей фазы: что запущено, код выхода и вывод; сбой запуска — сбой шага. */
    const command = async (input: { readonly args: readonly unknown[]; readonly phase?: string }) => {
      const [cmd, list] = input.args as [string, readonly string[]]
      const base = {
        id: `cmd:${deps.now()}:${++commands}`,
        actor: `$ ${cmd}`,
        ...(input.phase ? { phase: input.phase } : {}),
        instructions: [cmd, ...list].join(" "),
        started: deps.now(),
        metrics: BuffWorkflow.EMPTY_METRICS,
      }
      record({ ...base, status: "running" })
      try {
        const result = await observe.run("world.run", input.args)
        record({ ...base, status: "done", finished: deps.now(), result })
        return result
      } catch (error) {
        record({
          ...base,
          status: "failed",
          finished: deps.now(),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }
    const host: WorkflowExecute.Host = {
      actor: (actor) =>
        void deps.store.putActor(run.id, {
          key: actor.key,
          ...(actor.name ? { name: actor.name } : {}),
          ...(actor.role ? { role: actor.role } : {}),
        }),
      ask,
      cached: (step) =>
        record({
          id: step.key,
          actor: step.actor.key,
          phase: step.phase,
          instructions: step.instructions,
          status: "cached",
          started: deps.now(),
          finished: deps.now(),
          result: journal.get(step.key)?.value,
          metrics: BuffWorkflow.EMPTY_METRICS,
        }),
      observe: (input) => (input.op === "world.run" ? command(input) : observe.run(input.op, input.args)),
      log: (text) => void deps.store.addLog(run.id, { at: deps.now(), text }),
      report: (item, tag) => void deps.store.addItem(run.id, { value: item, ...(tag ? { artifact: tag } : {}) }),
      publish: async (input) => {
        const key = `${run.id}:${input.id}`
        const version = (versions.get(key) ?? 0) + 1
        versions.set(key, version)
        const options = (input.options ?? {}) as { title?: string; description?: string; primary?: boolean }
        const base = { id: input.id, kind: input.kind as BuffWorkflow.Artifact["kind"], version, ...options }
        if (input.kind === "file" && input.path) {
          const target = path.join(deps.artifacts, run.id, `${input.id}-${version}${path.extname(input.path)}`)
          await mkdir(path.dirname(target), { recursive: true })
          await copyFile(path.resolve(run.directory, input.path), target)
          await deps.store.putArtifact(run.id, { ...base, path: target })
        } else await deps.store.putArtifact(run.id, { ...base, content: input.content ?? "" })
        return { id: input.id, version }
      },
      declare: (input) =>
        void deps.store.putArtifact(run.id, {
          id: input.id,
          kind: input.kind as BuffWorkflow.Artifact["kind"],
          version: 1,
          spec: input.spec,
          ...((input.spec ?? {}) as { title?: string }),
        }),
    }
    const journalAdapter: WorkflowExecute.Journal = {
      get: (key) => journal.get(key),
      put: (key, entry) => {
        journal.set(key, entry)
        void deps.store.putEntry(run.id, key, entry)
      },
    }
    const done = WorkflowExecute.execute({
      compiled,
      args: run.args,
      host,
      journal: journalAdapter,
      signal: controller.signal,
    }).then(async (outcome) => {
      live.delete(run.id)
      const latest = runs.get(run.id) ?? run
      if (latest.status === "stopped") return
      const finished: BuffWorkflow.Run = {
        ...latest,
        updated: deps.now(),
        finished: deps.now(),
        metrics: BuffWorkflow.sum([...steps.values()].map((item) => item.metrics)),
        ...(outcome.status === "completed"
          ? { status: "completed", result: outcome.result }
          : outcome.status === "errored"
            ? { status: "errored", error: outcome.error }
            : {
                status: "stopped",
                stopReason: outcome.reason as BuffWorkflow.StopReason,
                ...(outcome.error ? { error: outcome.error } : {}),
              }),
      }
      await save(finished)
      if (finished.session)
        await deps.sessions.synthetic(
          finished.session,
          WorkflowNotify.done(finished, await deps.store.items(run.id), await deps.store.artifacts(run.id)),
          WorkflowNotify.doneSummary(finished),
        )
    })
    live.set(run.id, { run, compiled, controller, sessions, steps, done })
  }

  const engine = {
    start: async (input: Start) => {
      const session = input.root ?? (await deps.sessions.createRoot({ directory: input.directory, title: input.label }))
      const run: BuffWorkflow.Run = {
        id: deps.id(),
        label: input.label,
        ...(input.workflow ? { workflow: input.workflow } : {}),
        ...(input.scriptPath ? { scriptPath: input.scriptPath } : {}),
        directory: input.directory,
        session,
        status: "running",
        args: input.args,
        phases: input.compiled.phases,
        commands: input.compiled.commands,
        created: deps.now(),
        updated: deps.now(),
        metrics: BuffWorkflow.EMPTY_METRICS,
      }
      await save(run)
      if (input.script !== undefined) await deps.store.putScript(run.id, input.script)
      await execute(run, input.compiled, new Map())
      return { run: run.id, session }
    },
    /** Ждать окончания прогона (тесты, остановка). */
    settled: async (id: string) => {
      await live.get(id)?.done
    },
    stop: async (id: string, reason: BuffWorkflow.StopReason = "user") => {
      const running = live.get(id)
      if (!running) return false
      const latest = runs.get(id) ?? running.run
      await save({ ...latest, status: "stopped", stopReason: reason, updated: deps.now(), finished: deps.now() })
      running.controller.abort(reason)
      await Promise.all(
        [...running.sessions.values()].map((session) => deps.sessions.interrupt(session).catch(() => undefined)),
      )
      live.delete(id)
      return true
    },
    resume: async (id: string): Promise<{ readonly problem?: string }> => {
      const run = await current(id)
      if (!run) return { problem: "The run no longer exists." }
      if (!BuffWorkflow.resumable(run)) return { problem: "This run cannot be resumed." }
      const compiled = programs.get(id) ?? (await recompiled(id))
      if (!compiled) return { problem: "The run script was not saved — fix it through the chat." }
      const resumed: BuffWorkflow.Run = {
        ...run,
        status: "running",
        updated: deps.now(),
        started: deps.now(),
        spent: (run.spent ?? 0) + (run.finished ?? run.updated) - (run.started ?? run.created),
      }
      delete (resumed as { stopReason?: unknown }).stopReason
      delete (resumed as { finished?: unknown }).finished
      await save(resumed)
      await execute(resumed, compiled, await deps.store.journal(id))
      return {}
    },
    amend: async (
      id: string,
      input: {
        readonly compiled: WorkflowCompile.Compiled
        readonly script?: string
        readonly label?: string
        readonly scriptPath?: string
      },
    ) => {
      const previous = await current(id)
      if (!previous) return { problem: "The run no longer exists." }
      if (live.has(id)) await engine.stop(id, "superseded")
      const carried = new Map(WorkflowExecute.carried(await deps.store.journal(id)))
      const run: BuffWorkflow.Run = {
        ...previous,
        id: deps.id(),
        label: input.label ?? previous.label,
        ...(input.scriptPath ? { scriptPath: input.scriptPath } : {}),
        status: "running",
        phases: input.compiled.phases,
        commands: input.compiled.commands,
        created: deps.now(),
        updated: deps.now(),
        resumedFrom: id,
        metrics: BuffWorkflow.EMPTY_METRICS,
      }
      delete (run as { stopReason?: unknown }).stopReason
      delete (run as { finished?: unknown }).finished
      delete (run as { result?: unknown }).result
      const old = (await current(id)) ?? previous
      await save({ ...old, status: "stopped", stopReason: "superseded", supersededBy: run.id, updated: deps.now() })
      await save(run)
      if (input.script !== undefined) await deps.store.putScript(run.id, input.script)
      for (const [key, entry] of carried) await deps.store.putEntry(run.id, key, entry)
      await execute(run, input.compiled, carried)
      return { run: run.id }
    },
    /** Вопрос актёра: ждёт ответа, остальной прогон идёт; сессия прогона получает уведомление. */
    question: async (session: string, text: string): Promise<string> => {
      const owner = bySession.get(session)
      if (!owner) throw new Error("This session is not a workflow actor.")
      const run = await current(owner.run)
      const running = live.get(owner.run)
      const step = [...(running?.steps.values() ?? [])].findLast(
        (item) => item.actor === owner.actor && item.status === "running",
      )
      const asked: BuffWorkflow.Question = {
        id: deps.id(),
        actor: owner.actor,
        step: step?.id ?? "",
        text,
        asked: deps.now(),
      }
      await deps.store.putQuestion(owner.run, asked)
      if (step && running) {
        running.steps.set(step.id, { ...step, status: "waiting" })
        await deps.store.putStep(owner.run, { ...step, status: "waiting" })
      }
      const answer = new Promise<string>((resolve) =>
        questions.set(asked.id, { run: owner.run, resolve, question: asked }),
      )
      if (run?.session)
        await deps.sessions.synthetic(run.session, WorkflowNotify.question(run, asked), WorkflowNotify.questionSummary(asked))
      return answer
    },
    /** Актёр спросил разрешения у человека (или получил ответ): его шаг ждёт — это видно в ходе прогона. */
    permission: async (session: string, asked: boolean) => {
      const owner = bySession.get(session)
      const running = owner ? live.get(owner.run) : undefined
      if (!owner || !running) return
      const from = asked ? "running" : "approval"
      const step = [...running.steps.values()].findLast((item) => item.actor === owner.actor && item.status === from)
      if (!step) return
      const next = { ...step, status: asked ? ("approval" as const) : ("running" as const) }
      running.steps.set(step.id, next)
      await deps.store.putStep(owner.run, next)
    },
    answer: async (id: string, text: string): Promise<{ readonly problem?: string }> => {
      const waiting = questions.get(id)
      if (!waiting) return { problem: "This question is already closed." }
      questions.delete(id)
      await deps.store.putQuestion(waiting.run, { ...waiting.question, answer: text })
      const running = live.get(waiting.run)
      const step = running?.steps.get(waiting.question.step)
      if (step && running) {
        running.steps.set(step.id, { ...step, status: "running" })
        await deps.store.putStep(waiting.run, { ...step, status: "running" })
      }
      waiting.resolve(text)
      return {}
    },
    /** После перезапуска службы: прогоны, оставшиеся «выполняется», — прерваны и могут продолжиться. */
    recover: async (list: readonly BuffWorkflow.Run[]) => {
      for (const run of list)
        if (run.status === "running" || run.status === "pending")
          await save({ ...run, status: "stopped", stopReason: "interrupted", updated: deps.now() })
    },
  }

  const recompiled = async (id: string) => {
    const script = await deps.store.getScript(id)
    if (script === undefined) return undefined
    const result = WorkflowCompile.compile(script)
    return "js" in result ? result : undefined
  }

  return engine
}

export type Engine = ReturnType<typeof make>
