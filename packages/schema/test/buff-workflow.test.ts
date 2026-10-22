// Сценарии (#448): прогон по фазам и шагам, метрики на каждом уровне, итог словами.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffWorkflow } from "../src/buff-workflow.js"

// Слова схемы — английские; русские ожидания — через переводчик по каталогу (#472).
const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const metrics = (input: number, output: number, files = 0): BuffWorkflow.Metrics => ({
  tokens: { input, output, cache: 0, total: input + output },
  files: { added: files, deleted: 0, modified: 0 },
  lines: { added: files * 10, deleted: 0 },
})

const step = (id: string, phase: string | undefined, status: BuffWorkflow.StepStatus, m = metrics(0, 0)) => ({
  id,
  actor: "a",
  phase,
  instructions: "x",
  status,
  started: 0,
  metrics: m,
})

describe("phases of a run", () => {
  test("in declared order, each with its steps and a status", () => {
    const phases = BuffWorkflow.phases(
      ["Collect", "Review", "Report"],
      [
        step("1", "Collect", "done"),
        step("2", "Collect", "done"),
        step("3", "Review", "running"),
        step("4", "Review", "done"),
      ],
    )
    expect(phases.map((phase) => [phase.name, phase.status, phase.steps.length])).toEqual([
      ["Collect", "done", 2],
      ["Review", "running", 2],
      ["Report", "pending", 0],
    ])
  })
  test("a failed step fails its phase; steps outside any phase go to «No phase»", () => {
    const phases = BuffWorkflow.phases(["A"], [step("1", "A", "failed"), step("2", undefined, "done")])
    expect(phases.map((phase) => [phase.name, phase.status])).toEqual([
      ["A", "failed"],
      [BuffWorkflow.NO_PHASE, "done"],
    ])
  })
  test("a step waiting for permission keeps its phase going", () => {
    expect(BuffWorkflow.phases(["A"], [step("1", "A", "approval")])[0]!.status).toBe("running")
  })
  test("cached steps count as done", () => {
    expect(BuffWorkflow.phases(["A"], [step("1", "A", "cached")])[0]!.status).toBe("done")
  })
})

describe("metrics — the full set, summed at every level", () => {
  test("tokens, files, lines add up", () => {
    expect(BuffWorkflow.sum([metrics(10, 5, 1), metrics(1, 2, 2)])).toEqual({
      tokens: { input: 11, output: 7, cache: 0, total: 18 },
      files: { added: 3, deleted: 0, modified: 0 },
      lines: { added: 30, deleted: 0 },
    })
    expect(BuffWorkflow.sum([])).toEqual(BuffWorkflow.EMPTY_METRICS)
  })
  test("in words", () => {
    expect(BuffWorkflow.metricsText(metrics(1200, 34_000, 2), ru)).toBe(
      "35,2 тыс. токенов · файлы +2 ~0 −0 · строки +20 −0",
    )
    expect(BuffWorkflow.metricsText(metrics(1200, 34_000, 2))).toBe("35.2K tokens · files +2 ~0 −0 · lines +20 −0")
    expect(BuffWorkflow.tokens(950)).toBe("950")
    expect(BuffWorkflow.tokens(3_400_000, ru)).toBe("3,4 млн")
    expect(BuffWorkflow.tokens(3_000_000)).toBe("3M")
  })
})

describe("a run's outcome in words", () => {
  test("statuses and stop reasons", () => {
    expect(BuffWorkflow.runLabel({ status: "completed" }, ru)).toBe("Выполнен")
    expect(BuffWorkflow.runLabel({ status: "errored", error: "agent is not defined" }, ru)).toBe(
      "Ошибка в сценарии: agent is not defined",
    )
    expect(BuffWorkflow.runLabel({ status: "stopped", stopReason: "user" }, ru)).toBe("Остановлен вами")
    expect(BuffWorkflow.runLabel({ status: "stopped", stopReason: "interrupted" }, ru)).toBe(
      "Прерван: служба закрылась — можно продолжить",
    )
    expect(
      BuffWorkflow.runLabel({ status: "stopped", stopReason: "provider", error: "Недостаточно средств" }, ru),
    ).toBe("Остановлен: Недостаточно средств")
    expect(BuffWorkflow.runLabel({ status: "stopped", stopReason: "superseded" }, ru)).toBe(
      "Заменён исправленным прогоном",
    )
    expect(BuffWorkflow.runLabel({ status: "stopped", stopReason: "user" })).toBe("Stopped by you")
    expect(BuffWorkflow.resumable({ status: "stopped", stopReason: "user" })).toBe(true)
    expect(BuffWorkflow.resumable({ status: "stopped", stopReason: "superseded" })).toBe(false)
    expect(BuffWorkflow.resumable({ status: "errored" })).toBe(false)
  })
})

describe("what the person confirms before a run", () => {
  test("label, phases in order, commands, arguments, project", () => {
    expect(
      BuffWorkflow.confirmation(
        {
          label: "Проверка ветки",
          phases: ["Собрать изменения", "Проверить каждый файл", "Свести итог"],
          commands: ["bun", "git"],
          args: { base: "main" },
          directory: "/p",
          actors: 3,
        },
        ru,
      ),
    ).toEqual([
      "Сценарий «Проверка ветки» в /p",
      "Фазы: 1. Собрать изменения → 2. Проверить каждый файл → 3. Свести итог",
      "Команды, которые он запустит: bun, git",
      'Аргументы: base="main"',
      "Именованных актёров: 3",
    ])
    expect(
      BuffWorkflow.confirmation({ label: "x", phases: ["A"], commands: [], args: {}, directory: "/p", actors: 0 }, ru),
    ).toEqual(["Сценарий «x» в /p", "Фазы: 1. A", "Команд не запускает"])
    expect(
      BuffWorkflow.confirmation({ label: "x", phases: [], commands: ["ls"], args: {}, directory: "/p", actors: 0 }, ru),
    ).toEqual(["Сценарий «x» в /p", "Команды, которые он запустит: ls"])
    expect(
      BuffWorkflow.confirmation({ label: "x", phases: [], commands: ["ls"], args: {}, directory: "/p", actors: 0 }),
    ).toEqual(["Workflow «x» in /p", "Commands it will run: ls"])
  })
  test("saving says new or overwrite", () => {
    expect(
      BuffWorkflow.saveConfirmation({ name: "review", description: "Проверить", created: true, phases: ["A"] }, ru),
    ).toEqual(["Сохранить новый сценарий «review»: Проверить", "Фазы: 1. A"])
    expect(
      BuffWorkflow.saveConfirmation({ name: "review", description: "Проверить", created: false, phases: [] }, ru)[0],
    ).toBe("Перезаписать сценарий «review»: Проверить")
  })
})

describe("the permission request", () => {
  test("title and hint by what is confirmed: run, amend, save, snippet", () => {
    expect(BuffWorkflow.permissionView({ kind: "run" })).toEqual({
      title: "Run workflow",
      hint: BuffWorkflow.PERMISSION_HINT,
    })
    expect(BuffWorkflow.permissionView({ kind: "run" }, ru)).toEqual({
      title: "Запустить сценарий",
      hint: ru(BuffWorkflow.PERMISSION_HINT),
    })
    expect(ru(BuffWorkflow.PERMISSION_HINT)).toStartWith("Агент предлагает запустить сценарий")
    expect(BuffWorkflow.permissionView({ kind: "amend" }, ru).title).toBe("Исправить прогон сценария")
    expect(BuffWorkflow.permissionView({ kind: "save" }, ru)).toEqual({
      title: "Сохранить сценарий",
      hint: ru(BuffWorkflow.SAVE_HINT),
    })
    expect(BuffWorkflow.permissionView({ kind: "eval" }, ru).title).toBe("Проверить кусочек сценария")
  })
  test("unknown metadata reads as a run", () => {
    expect(BuffWorkflow.permissionView(undefined, ru).title).toBe("Запустить сценарий")
  })
})

describe("time spent", () => {
  const base = { created: 1_000, updated: 5_000 }
  test("while running — until now; once done — until it finished", () => {
    expect(BuffWorkflow.elapsed({ ...base, status: "running" }, 61_000, ru)).toBe("1 мин 00 с")
    expect(BuffWorkflow.elapsed({ ...base, status: "completed", finished: 4_000 }, 99_000, ru)).toBe("3 с")
    expect(BuffWorkflow.elapsed({ ...base, status: "stopped" }, 99_000, ru)).toBe("4 с")
  })
})

describe("time of a resumed run", () => {
  test("only running time counts: earlier periods plus the current one", () => {
    const run = { created: 0, updated: 0, status: "running" as const, started: 100_000, spent: 30_000 }
    expect(BuffWorkflow.elapsed(run, 110_000, ru)).toBe("40 с")
    expect(BuffWorkflow.elapsed({ ...run, status: "completed", finished: 105_000 }, 999_000, ru)).toBe("35 с")
  })
})

describe("time of a step", () => {
  test("an unfinished step — until now, whatever it waits for; a finished one — until it finished", () => {
    const at = (status: BuffWorkflow.StepStatus, finished?: number): BuffWorkflow.Step => ({
      id: "s",
      actor: "a",
      instructions: "",
      status,
      started: 1_000,
      ...(finished === undefined ? {} : { finished }),
      metrics: BuffWorkflow.EMPTY_METRICS,
    })
    expect(BuffWorkflow.stepElapsed(at("approval"), 6_000, ru)).toBe("5 с")
    expect(BuffWorkflow.stepElapsed(at("waiting"), 4_000, ru)).toBe("3 с")
    expect(BuffWorkflow.stepElapsed(at("done", 3_000), 99_000, ru)).toBe("2 с")
  })
})
