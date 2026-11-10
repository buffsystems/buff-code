export * as BuffConnectionScript from "./connection-script.js"

import path from "node:path"
import { createHash } from "node:crypto"
import type { Mcp } from "@opencode/schema/mcp"
import runnerText from "./setup/runner/connection-runner.txt" with { type: "text" }

/**
 * Скриптовое подключение (#765): модель пишет небольшой модуль с инструментами, Buff Code
 * запускает его своим бинарником в режиме bun через раннер — без Node, Python и зависимостей.
 * Здесь — где лежат файлы, что записать в конфигурацию и когда раннер нужно обновить.
 */

/** Команда, которую служба MCP заменяет на бинарник Buff Code в режиме bun. */
export const SELF = "buff"
export const DIR = "connections"
export const RUNNER = "_runner.mjs"

export const runner = runnerText

/** Отпечаток раннера в его первой строке — чтобы обновлять файл вместе с Buff Code. */
const hash = createHash("sha1").update(runnerText).digest("hex").slice(0, 12)
export const stamped = `// buff-runner ${hash}\n${runnerText}`

export function paths(configDirectory: string, name: string) {
  const directory = path.join(configDirectory, DIR)
  return { directory, runner: path.join(directory, RUNNER), script: path.join(directory, `${name}.ts`) }
}

/** Раннер на диске устарел или отсутствует — переписать. */
export function stale(current: string | undefined): boolean {
  return current?.split("\n", 1)[0] !== `// buff-runner ${hash}`
}

export function config(
  files: { readonly runner: string; readonly script: string },
  environment: Record<string, string>,
): Mcp.ServerConfig {
  return {
    type: "local",
    command: [SELF, files.runner, files.script],
    ...(Object.keys(environment).length ? { environment } : {}),
  }
}

/** Это скриптовое подключение Buff Code — по его команде. */
export function isScript(serverConfig: Mcp.ServerConfig): boolean {
  return (
    serverConfig.type === "local" &&
    serverConfig.command[0] === SELF &&
    serverConfig.command[1]?.endsWith(RUNNER) === true
  )
}

/** Что модель должна соблюсти в модуле; пустой код или без `tools` — отказ словами. */
export function problem(code: string): string | undefined {
  if (!code.trim()) return "The script is empty."
  if (!/export\s+(const|let|var|default|function|async\s+function)\s/.test(code) && !/export\s*\{/.test(code))
    return "The script must export `tools` (an array of { name, description, input, run })."
  return undefined
}
