export * as WorkflowAnalyze from "./analyze.js"

import ts from "typescript"
import { WorkflowProgram } from "./program.js"

/**
 * Правила скрипта сценария (#448), как в ZCode: фазы, имена актёров, команды и артефакты —
 * литералы (их показывают человеку до запуска); каждый шаг в фазе, в каждой фазе есть шаг; имя
 * актёра единственно. Попутно — что видит подтверждение (фазы, команды, актёры) и правки текста
 * для исполнения: фаза становится областью, `ask<T>` получает номер своей схемы.
 */

export interface Edit {
  readonly at: number
  readonly end: number
  readonly text: string
}

const PRESETS = new Set(["chart", "table", "metrics", "board"])
const KINDS = new Set(["file", "markdown", ...PRESETS])

const literal = (node: ts.Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
const callee = (call: ts.CallExpression): [string, string] | [string] | undefined => {
  const target = call.expression
  if (ts.isIdentifier(target)) return [target.text]
  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression))
    return [target.expression.text, target.name.text]
  return undefined
}
const isAsk = (call: ts.CallExpression) =>
  ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "ask"
const isRun = (call: ts.CallExpression) => callee(call)?.join(".") === "world.run"
const isPhaseCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "phase"
const markerOf = (statement: ts.Statement) =>
  ts.isExpressionStatement(statement) && isPhaseCall(statement.expression) ? statement.expression : undefined
const isCallback = (node: ts.Node) =>
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !!node.parent && ts.isCallExpression(node.parent)

/** То, что даёт разное при повторе по журналу: повтор прогона перестал бы совпадать с прогоном. */
const unreplayable = (node: ts.Node) => {
  if (ts.isNewExpression(node))
    return ts.isIdentifier(node.expression) && node.expression.text === "Date" && !node.arguments?.length
  if (!ts.isCallExpression(node)) return false
  const name = callee(node)?.join(".")
  return name === "Date.now" || name === "Math.random"
}

export function analyze(source: ts.SourceFile, options: { readonly snippet?: boolean } = {}) {
  const problems: WorkflowProgram.Diagnostic[] = []
  const phases: string[] = []
  const commands: string[] = []
  const names = new Map<string, number>()
  const artifacts = new Map<string, string>()
  const tags: { tag: string; node: ts.Node }[] = []
  const asks: { call: ts.CallExpression; type: ts.TypeNode }[] = []
  const edits: Edit[] = []
  const helpers = new Set<string>()
  let primaries = 0
  let scopes = 0
  const fail = (node: ts.Node, message: string): void => {
    problems.push(WorkflowProgram.at(source, node.getStart(source), message))
  }

  const hasStep = (nodes: readonly ts.Node[]): boolean =>
    nodes.some((node) => {
      let found = false
      const look = (child: ts.Node): void => {
        if (found) return
        if (ts.isCallExpression(child) && (isAsk(child) || isRun(child) || helpers.has(callee(child)?.[0] ?? "")))
          found = true
        else ts.forEachChild(child, look)
      }
      look(node)
      return found
    })

  const block = (statements: readonly ts.Statement[], close: number, phase: string | undefined, nested: Flags) => {
    let current = phase
    const opened: number[] = []
    statements.forEach((statement, index) => {
      const marker = markerOf(statement)
      if (!marker) return visit(statement, current, nested)
      const name = literal(marker.arguments[0])
      if (name === undefined || !name.trim())
        return fail(marker, 'A phase name is a quoted string right in the phase("…") call.')
      const rest = statements.slice(index + 1)
      const until = rest.findIndex((next) => markerOf(next) !== undefined)
      if (!options.snippet && !hasStep(until < 0 ? rest : rest.slice(0, until)))
        fail(marker, `Phase «${name}» has no ask or world.run.`)
      if (!phases.includes(name)) phases.push(name)
      current = name
      const id = scopes++
      opened.push(id)
      edits.push({
        at: statement.getStart(source),
        end: statement.end,
        text: `{ const __p${id} = __phaseEnter(${JSON.stringify(name)}); try {`,
      })
    })
    if (opened.length)
      edits.push({
        at: close,
        end: close,
        text: opened
          .toReversed()
          .map((id) => ` } finally { __phaseExit(__p${id}) } }`)
          .join(""),
      })
  }

  type Flags = { readonly loop: boolean; readonly fn: boolean; readonly branch: boolean }

  const visit = (node: ts.Node, phase: string | undefined, flags: Flags): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node))
      return fail(node, "A workflow has no import or export: the result is the last return.")
    if (
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword || m.kind === ts.SyntaxKind.ExportKeyword)
    )
      fail(node, "A workflow has no declare or export: declare plain interface and type.")
    if (unreplayable(node))
      fail(
        node,
        "Date.now(), new Date() and Math.random() give different values when a run is replayed — pass the value as an argument or ask an actor.",
      )
    if (ts.isCallExpression(node)) call(node, phase, flags)
    if (ts.isBlock(node) || ts.isModuleBlock(node)) return block(node.statements, node.end - 1, phase, flags)
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return block(node.statements, node.end, phase, flags)
    const next: Flags = {
      loop: flags.loop || ts.isIterationStatement(node, false) || isCallback(node),
      fn: flags.fn || ts.isFunctionLike(node),
      branch: flags.branch || ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node),
    }
    ts.forEachChild(node, (child) => visit(child, phase, next))
  }

  const call = (node: ts.CallExpression, phase: string | undefined, flags: Flags) => {
    const [object, member] = callee(node) ?? []
    if (isPhaseCall(node) && !(node.parent && ts.isExpressionStatement(node.parent)))
      fail(node, 'phase("…") is a statement of its own, not part of an expression.')
    if (
      options.snippet &&
      ((object === "agent" && member === undefined) || (object === "report" && member === undefined))
    )
      fail(node, "A trial snippet has no agent() or report(): only observations and logic.")
    if (!options.snippet && (isAsk(node) || isRun(node)) && phase === undefined && !flags.fn)
      fail(node, 'A step outside a phase: put phase("…") before it.')
    if (isAsk(node) && node.typeArguments?.[0]) {
      asks.push({ call: node, type: node.typeArguments[0] })
      // Сразу после последнего аргумента: у многострочного вызова после него висячая запятая (#470).
      const at = node.arguments.at(-1)?.end ?? node.arguments.end
      edits.push({ at, end: at, text: `, ${asks.length - 1}` })
    }
    if (object === "agent" && member === undefined) {
      const name = literal(node.arguments[0])
      if (name) {
        names.set(name, (names.get(name) ?? 0) + 1)
        if (names.get(name) === 2) fail(node, `Two actors named «${name}»: an actor name must be unique.`)
        if (flags.loop)
          fail(
            node,
            `Actor «${name}» is created in a loop under one name: compute the name (agent("${name}-" + …)) or leave it unnamed.`,
          )
      }
    }
    if (object === "world" && member === "run") {
      const command = literal(node.arguments[0])
      if (command === undefined)
        fail(
          node,
          "A world.run command is a quoted string right in the call: it is shown to the person before the run.",
        )
      else if (!commands.includes(command)) commands.push(command)
    }
    if (object === "artifact" && member && KINDS.has(member)) artifact(node, member, flags)
    if (object === "report" && member === undefined && node.arguments[1]) {
      const tag = literal(node.arguments[1])
      if (tag === undefined) fail(node, "A report tag is a quoted string: the name of a declared panel.")
      else tags.push({ tag, node })
    }
  }

  const artifact = (node: ts.CallExpression, kind: string, flags: Flags) => {
    const id = literal(node.arguments[0])
    if (id === undefined) return fail(node, "An artifact name is a quoted string right in the call.")
    const known = artifacts.get(id)
    if (known && known !== kind) fail(node, `Artifact «${id}» is declared twice with different kinds.`)
    artifacts.set(id, kind)
    if (PRESETS.has(kind) && (flags.loop || flags.fn || flags.branch))
      fail(node, `Panel «${id}» is declared at the top level of the workflow, not in a loop, function or branch.`)
    const options = node.arguments[PRESETS.has(kind) ? 1 : 2]
    const primary =
      options &&
      ts.isObjectLiteralExpression(options) &&
      options.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          p.name.text === "primary" &&
          p.initializer.kind === ts.SyntaxKind.TrueKeyword,
      )
    if (primary && ++primaries === 2) fail(node, "At most one main artifact (primary: true).")
  }

  const body = (source.statements[0] as ts.FunctionDeclaration | undefined)?.body
  if (body) {
    for (const statement of body.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) helpers.add(statement.name.text)
      if (ts.isVariableStatement(statement))
        for (const item of statement.declarationList.declarations)
          if (
            ts.isIdentifier(item.name) &&
            item.initializer &&
            (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))
          )
            helpers.add(item.name.text)
    }
    block(body.statements, body.end - 1, undefined, { loop: false, fn: false, branch: false })
  }
  for (const { tag, node } of tags)
    if (!PRESETS.has(artifacts.get(tag) ?? ""))
      fail(node, `report(…, "${tag}"): the workflow has no such panel — declare artifact.chart/table/metrics/board.`)
  const actors = [...names.keys()]
  return {
    problems,
    phases,
    commands,
    actors,
    artifacts: [...artifacts].map(([id, kind]) => ({ id, kind })),
    asks,
    edits,
  }
}
