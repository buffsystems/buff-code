// Сценарии (#448): скрипт проверяется по фасаду до запуска — типы, правила, фазы, команды, схемы.
import { describe, expect, test } from "bun:test"
import { WorkflowCompile } from "../../src/buff/workflow/compile"

const good = `interface Finding {
  /** Путь файла от корня проекта. */
  path: string
  /** Насколько важно. */
  severity: "low" | "high"
  note?: string
  tags: string[]
}
phase("Собрать файлы")
const changed = await git.changedFiles()
const test = await world.run("bun", ["test"])
phase("Проверить каждый файл")
const found = await Promise.all(changed.map((file) => agent("ревьюер-" + file).ask<Finding>("Проверь " + file)))
const summary = await agent("итог").ask("Сведи: " + JSON.stringify(found) + test.exitCode)
return summary
`

describe("a good script", () => {
  const result = WorkflowCompile.compile(good)
  test("compiles", () => {
    expect(result.diagnostics).toEqual([])
  })
  test("phases in order, the commands it runs, the named actors", () => {
    if (!("js" in result)) throw new Error("no js")
    expect(result.phases).toEqual(["Собрать файлы", "Проверить каждый файл"])
    expect(result.commands).toEqual(["bun"])
    expect(result.actors).toEqual(["итог"])
  })
  test("ask<T> gets a schema from T, JSDoc as field descriptions", () => {
    if (!("js" in result)) throw new Error("no js")
    expect(result.schemas).toEqual([
      {
        type: "object",
        properties: {
          path: { type: "string", description: "Путь файла от корня проекта." },
          severity: { type: "string", enum: ["low", "high"], description: "Насколько важно." },
          note: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["path", "severity", "tags"],
        additionalProperties: false,
      },
    ])
  })
})

const problems = (script: string) => WorkflowCompile.compile(script).diagnostics.map((item) => item.message)
const head = 'phase("Шаг")\n'

describe("what is refused, in words", () => {
  test("type errors, with the script's own line", () => {
    const result = WorkflowCompile.compile(head + 'const a = agent("a")\nawait a.ask(42)\n')
    expect(result.diagnostics[0]?.line).toBe(3)
    expect(result.diagnostics[0]?.message).toContain("number")
  })
  test("no Node or web APIs", () => {
    expect(problems(head + 'await fetch("x")\nawait agent("a").ask("x")')[0]).toContain("fetch")
    expect(problems(head + "process.exit(1)\nawait agent('a').ask('x')")[0]).toContain("process")
  })
  test("phase names are literals, standalone statements", () => {
    expect(problems('const n = "x"\nphase(n)\nawait agent("a").ask("x")')).toContain(
      'A phase name is a quoted string right in the phase("…") call.',
    )
    expect(problems('const x = phase("a")\nawait agent("a").ask("x")')).toContain(
      'phase("…") is a statement of its own, not part of an expression.',
    )
  })
  test("every step is inside a phase, and every phase has a step", () => {
    expect(problems('await agent("a").ask("x")\nphase("Потом")\nawait agent("b").ask("y")')).toContain(
      'A step outside a phase: put phase("…") before it.',
    )
    expect(problems('phase("Пустая")\nconst x = 1\nphase("Дело")\nawait agent("a").ask("x")')).toContain(
      "Phase «Пустая» has no ask or world.run.",
    )
  })
  test("actor names are unique; a literal name in a loop is a duplicate", () => {
    expect(problems(head + 'await agent("a").ask("1")\nawait agent("a").ask("2")')).toContain(
      "Two actors named «a»: an actor name must be unique.",
    )
    expect(problems(head + 'for (const x of [1, 2]) await agent("a").ask("1")')).toContain(
      'Actor «a» is created in a loop under one name: compute the name (agent("a-" + …)) or leave it unnamed.',
    )
  })
  test("commands are literals", () => {
    const cmd = "bun"
    expect(problems(head + `const c = "${cmd}"\nawait world.run(c)`)).toContain(
      "A world.run command is a quoted string right in the call: it is shown to the person before the run.",
    )
  })
  test("dashboards: literal ids, declared before tagging, one kind per id, one primary", () => {
    expect(problems(head + 'report({ a: 1 }, "нет")\nawait agent("a").ask("x")')).toContain(
      'report(…, "нет"): the workflow has no such panel — declare artifact.chart/table/metrics/board.',
    )
    expect(
      problems(
        head +
          'artifact.table("t", { columns: [{ field: "a" }] })\nartifact.chart("t", { x: { field: "a" }, y: { field: "b" } })\nawait agent("a").ask("x")',
      ),
    ).toContain("Artifact «t» is declared twice with different kinds.")
    expect(
      problems(
        head +
          'await artifact.markdown("a", "x", { primary: true })\nawait artifact.markdown("b", "y", { primary: true })\nawait agent("a").ask("x")',
      ),
    ).toContain("At most one main artifact (primary: true).")
  })
  test("nothing that differs between a run and its replay", () => {
    const message =
      "Date.now(), new Date() and Math.random() give different values when a run is replayed — pass the value as an argument or ask an actor."
    expect(problems(head + 'const t = Date.now()\nawait agent("a").ask("x" + t)')).toContain(message)
    expect(problems(head + 'const r = Math.random()\nawait agent("a").ask("x" + r)')).toContain(message)
    expect(problems(head + 'const d = new Date()\nawait agent("a").ask("x" + d)')).toContain(message)
    expect(problems(head + 'const d = new Date("2026-10-03")\nawait agent("a").ask("x" + d)')).toEqual([])
  })
  test("no import, export or declare", () => {
    expect(problems('import x from "y"\n' + head + 'await agent("a").ask("x")').length).toBeGreaterThan(0)
  })
})

describe("the emitted code", () => {
  test("phases become scopes; ask<T> carries its schema index", () => {
    const result = WorkflowCompile.compile(good)
    if (!("js" in result)) throw new Error("no js")
    expect(result.js).toContain('__phaseEnter("Собрать файлы")')
    expect(result.js).toContain("__phaseExit(")
    expect(result.js).toContain('.ask("Проверь " + file, 0)')
    expect(result.js).not.toContain("interface Finding")
  })
  // #470: Prettier ставит висячую запятую в многострочный вызов — номер схемы встаёт до неё,
  // иначе код не разбирается («const declared variable 'agent' must have an initializer»).
  test("ask<T> with a trailing comma still carries its schema index and parses", () => {
    const script = `interface Review {
  notes: string[]
}
phase("Ревью")
const [a, b] = await Promise.all([
  agent("один").ask<Review>(
    "Посмотри src/cart.js",
  ),
  agent("два").ask<Review>(
    "Посмотри ещё раз",
  ),
])
return a.notes.length + b.notes.length
`
    const result = WorkflowCompile.compile(script)
    if (!("js" in result)) throw new Error(JSON.stringify(result.diagnostics))
    expect(result.js).toContain('.ask("Посмотри src/cart.js", 0)')
    expect(result.js).toContain('.ask("Посмотри ещё раз", 1)')
    expect(() => new Function(result.js)).not.toThrow()
  })
})
