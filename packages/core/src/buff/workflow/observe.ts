export * as WorkflowObserve from "./observe.js"

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Наблюдения сценария (#448) за рабочим каталогом: файлы, git, команды. Только внутри проекта;
 * команды — фиксированный список аргументов без оболочки; git — только читающие подкоманды.
 * Вывод отдаётся целиком. Ненулевой код выхода команды — значение, а не ошибка.
 */

const DEFAULT_TIMEOUT = 300_000

interface Spawned {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function exec(cmd: string, args: readonly string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Command ${cmd} did not finish within ${timeoutMs} ms.`))
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(new Error(`Command ${cmd} did not start: ${error.message}`))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      })
    })
  })
}

const lines = (text: string) => text.split("\n").filter(Boolean)

export function make(input: { readonly cwd: string; readonly rg: string }) {
  const { cwd } = input
  const inside = (relative: string) => {
    const target = path.resolve(cwd, relative)
    if (target !== cwd && !target.startsWith(cwd + path.sep))
      throw new Error(`Path ${relative} is outside the project.`)
    return target
  }
  const git = async (args: readonly string[]) => {
    const result = await exec("git", args, cwd)
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed.`)
    return result.stdout
  }
  const rg = (args: readonly string[]) => exec(input.rg, args, cwd)

  const ops: Record<string, (...args: never[]) => Promise<unknown>> = {
    "files.glob": async (pattern: string) => lines((await rg(["--files", "--glob", pattern])).stdout).sort(),
    "files.read": async (relative: string) => readFile(inside(relative), "utf8"),
    "files.grep": async (pattern: string, glob?: string) => {
      const result = await rg(["--json", ...(glob ? ["--glob", glob] : []), "--", pattern])
      if (result.exitCode > 1) throw new Error(result.stderr.trim() || "The search failed.")
      return lines(result.stdout).flatMap((line) => {
        const event = JSON.parse(line) as {
          type: string
          data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } }
        }
        if (event.type !== "match" || !event.data) return []
        return [
          {
            path: event.data.path?.text ?? "",
            line: event.data.line_number ?? 0,
            text: (event.data.lines?.text ?? "").replace(/\r?\n$/, ""),
          },
        ]
      })
    },
    "git.changedFiles": async (base?: string) => {
      const tracked = lines(await git(["diff", "--name-only", "--relative", base ?? "HEAD"]))
      const untracked = base ? [] : lines(await git(["ls-files", "--others", "--exclude-standard"]))
      return [...new Set([...tracked, ...untracked])].sort()
    },
    "git.diff": async (base?: string, paths?: string[]) =>
      git(["diff", "--relative", base ?? "HEAD", ...(paths?.length ? ["--", ...paths] : [])]),
    "git.log": async (count?: number) =>
      lines(await git(["log", ...(count ? ["-n", String(count)] : []), "--format=%H%x1f%s%x1f%an%x1f%aI"])).map(
        (line) => {
          const [hash = "", subject = "", author = "", date = ""] = line.split("\x1f")
          return { hash, subject, author, date }
        },
      ),
    "git.status": async () => {
      const output = lines(await git(["status", "--porcelain=v1", "--branch", "--untracked-files=all"]))
      const head = output[0]?.startsWith("## ") ? output.shift()!.slice(3) : ""
      const branch = head.startsWith("HEAD (no branch)") ? undefined : head.split("...")[0]
      const staged: string[] = []
      const unstaged: string[] = []
      const untracked: string[] = []
      for (const line of output) {
        const [x, y, file] = [line[0], line[1], line.slice(3)]
        if (x === "?") untracked.push(file)
        else {
          if (x !== " ") staged.push(file)
          if (y !== " ") unstaged.push(file)
        }
      }
      return {
        ...(branch ? { branch } : {}),
        clean: !staged.length && !unstaged.length && !untracked.length,
        staged,
        unstaged,
        untracked,
      }
    },
    "world.run": async (cmd: string, args: string[] = [], options: { timeoutMs?: number } = {}) =>
      exec(cmd, args, cwd, options.timeoutMs),
  }

  return {
    run: (op: string, args: readonly unknown[]) => {
      const handler = ops[op]
      if (!handler) return Promise.reject(new Error(`Unknown observation: ${op}`))
      return Promise.resolve().then(() => handler(...(args as never[])))
    },
  }
}
