export * as WorkflowProgram from "./program.js"

import ts from "typescript"
import facade from "./facade.txt" with { type: "text" }
import { entry, files } from "./libs.js"

/**
 * Проверка типов скрипта сценария (#448): скрипт — тело асинхронной функции (верхнеуровневые
 * `await` и `return` разрешены), рядом — фасад и стандартные объявления ES2022 без DOM и Node.
 * Всё в памяти: файлы библиотек встроены в сборку, разобранные библиотеки переиспользуются.
 */

export const SCRIPT = "/script.ts"
export const HEAD = "async function __buff_workflow__() {\n"
export const TAIL = "\n}\n"

const FACADE = "/facade.d.ts"
const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noUncheckedIndexedAccess: false,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  lib: [entry],
  types: [],
  noEmit: true,
  skipLibCheck: true,
}

const parsed = new Map<string, ts.SourceFile>()
function fixed(name: string): ts.SourceFile | undefined {
  const cached = parsed.get(name)
  if (cached) return cached
  const text = name === FACADE ? facade : files[name.slice(1)]
  if (text === undefined) return undefined
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true)
  parsed.set(name, file)
  return file
}

export function create(script: string) {
  const source = ts.createSourceFile(SCRIPT, HEAD + script + TAIL, ts.ScriptTarget.ES2022, true)
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === SCRIPT ? source : fixed(name)),
    getDefaultLibFileName: () => "/" + entry,
    getDefaultLibLocation: () => "/",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (name) => name === SCRIPT || fixed(name) !== undefined,
    readFile: (name) => (name === SCRIPT ? source.text : fixed(name)?.text),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  }
  const program = ts.createProgram({ rootNames: [FACADE, SCRIPT], options: OPTIONS, host })
  return { program, source, checker: program.getTypeChecker() }
}

export interface Diagnostic {
  /** Строка и столбец в самом скрипте, с единицы. */
  readonly line: number
  readonly column: number
  readonly message: string
}

/** Ошибки типов в скрипте — с его собственными номерами строк. */
export function diagnostics(program: ts.Program, source: ts.SourceFile): Diagnostic[] {
  return ts
    .getPreEmitDiagnostics(program, source)
    .map((item) => at(source, item.start ?? 0, ts.flattenDiagnosticMessageText(item.messageText, "\n")))
}

export function at(source: ts.SourceFile, position: number, message: string): Diagnostic {
  const place = source.getLineAndCharacterOfPosition(Math.max(position, HEAD.length))
  return { line: place.line, column: place.character + 1, message }
}
