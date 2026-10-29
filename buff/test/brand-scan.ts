// Сканер имени продукта в строках (#596, #628): строки и текст разметки в коде продукта, где
// OpenCode/opencode стоит словом — то есть так, как его прочтёт человек. Имена-идентификаторы
// (@opencode/…, opencode-pty, opencode.json, opencode.ai, ключи вида opencode.settings) не
// считаются: у них имя склеено точкой, дефисом, косой чертой или буквой.
import ts from "typescript"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export const root = join(import.meta.dir, "..", "..")

/** Код, который видит пользователь: окно, консоль, терминальный интерфейс, служба и SDK. */
export const PRODUCT = [
  "app/src",
  "app-react/src",
  "session-ui/src",
  "ui/src",
  "desktop/src",
  "tui/src",
  "cli/src",
  "core/src",
  "server/src",
  "sdk/src",
  "client/src",
  "protocol/src",
  "schema/src",
  "util/src",
  "plugin-browser/src",
]

/** Словари переводов апстрима: имя в них подставляет brandDictionary при загрузке (#398). */
const CATALOGS = [/^packages\/app\/src\/runtime\/i18n\//, /^packages\/ui\/src\/i18n\//, /^packages\/app\/src\/buff\/i18n\//]

const WORD = /(?<![\w.\/@-])open ?code(?![\w.\/-])/i

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === "node_modules" || name === "storybook") return []
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|stories|d)\.tsx?$/.test(name) ? [path] : []
  })
}

/** Строки, где имя стоит словом: текст из нескольких слов или ровно «OpenCode». */
export function brandStrings(): { path: string; line: number; text: string }[] {
  return PRODUCT.flatMap((dir) => files(join(root, "packages", dir))).flatMap((file) => {
    const path = relative(root, file)
    const source = readFileSync(file, "utf8")
    if (CATALOGS.some((re) => re.test(path)) || !WORD.test(source)) return []
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const found: { path: string; line: number; text: string }[] = []
    const visit = (node: ts.Node) => {
      const text =
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)
          ? node.text.trim()
          : undefined
      if (text && WORD.test(text) && (/\s/.test(text) || text === "OpenCode") && !ts.isImportDeclaration(node.parent))
        found.push({ path, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text })
      ts.forEachChild(node, visit)
    }
    visit(tree)
    return found
  })
}

/**
 * Имя входа на сервер, набранное строкой «opencode» (#628): `username: "opencode"`,
 * `username ?? "opencode"`, `Schema.Literal("opencode")` у поля username, Basic-строка
 * `opencode:${пароль}`. Своё имя и прежнее живут константами в `schema/src/buff-server-auth.ts`
 * (USERNAME — то, что видит человек; LEGACY_USERNAME — для серверов прежних выпусков), так что
 * строка «opencode» в роли имени — это имя апстрима, которое увидят в `buff pair`, ссылке или коде
 * сопряжения.
 */
export function legacyUsernames(): { path: string; line: number; text: string }[] {
  return PRODUCT.flatMap((dir) => files(join(root, "packages", dir))).flatMap((file) => {
    const source = readFileSync(file, "utf8")
    if (!/username|opencode:/.test(source)) return []
    const path = relative(root, file)
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const found: { path: string; line: number; text: string }[] = []
    const hit = (node: ts.Node) =>
      found.push({ path, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.getText().replace(/\s+/g, " ") })
    const named = (node: ts.Node): boolean =>
      ts.isStringLiteral(node) ? node.text === "opencode" : ts.forEachChild(node, (child) => named(child) || undefined) === true
    // Basic-строка «имя:пароль» кодируется сразу: btoa(`…`) или Buffer.from(`…`).
    const basic = (node: ts.Node) => ts.isCallExpression(node) && /^(btoa|Buffer\.from)$/.test(node.expression.getText())
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && /^username$/i.test(node.name.getText()) && named(node.initializer)) hit(node)
      else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
        /username/i.test(node.left.getText()) &&
        named(node.right)
      )
        hit(node)
      else if (ts.isTemplateExpression(node) && /^opencode:$/.test(node.head.text) && basic(node.parent)) hit(node)
      else ts.forEachChild(node, visit)
    }
    visit(tree)
    return found
  })
}
