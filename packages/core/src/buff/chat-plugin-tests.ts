export * as BuffChatPluginTests from "./chat-plugin-tests.js"

import type { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"

/**
 * Живая проверка плагина чатов (#595, #984): инструмент кладёт задание в метаданные своего
 * вызова, клиент, который показывает чат, рисует примеры в настоящей рамке и отвечает по RPC.
 * Здесь — ожидание этих ответов: до последнего примера либо до срока. Ответить может не один
 * клиент (окно и телефон открыты разом) — берётся первый ответ на пример.
 *
 * Окно видит задание в метаданных идущего вызова (живые события). Телефон и веб-клиент читают
 * чат снимками, где этих метаданных нет, — им задания отдаёт `pending`.
 */
export function make() {
  const open = new Map<
    string,
    {
      readonly names: ReadonlySet<string>
      readonly results: Map<string, BuffChatPlugin.TestResult>
      readonly task?: BuffChatPlugin.Test
      done: () => void
    }
  >()
  return {
    /** Ждать ответов по примерам `names` не дольше `timeout` мс; отдаёт то, что пришло. */
    wait(
      key: string,
      names: readonly string[],
      timeout: number,
      task?: BuffChatPlugin.Test,
    ): Promise<Map<string, BuffChatPlugin.TestResult>> {
      return new Promise((resolve) => {
        const results = new Map<string, BuffChatPlugin.TestResult>()
        const finish = () => {
          clearTimeout(timer)
          open.delete(key)
          resolve(results)
        }
        const timer = setTimeout(finish, timeout)
        open.set(key, { names: new Set(names), results, ...(task ? { task } : {}), done: finish })
        if (!names.length) finish()
      })
    },
    /**
     * Задания чата, которых ещё ждут: вызов и что нарисовать — без текста примеров (его клиент
     * читает сам), и только примеры, по которым ответа ещё нет.
     */
    pending(session: string): BuffChatPlugin.PendingTest[] {
      const prefix = `${session}:`
      return [...open].flatMap(([key, waiting]) => {
        const task = waiting.task
        if (!key.startsWith(prefix) || !task) return []
        const examples = task.examples
          .filter((example) => !waiting.results.has(example.name))
          .map((example) => ({ name: example.name, block: example.block }))
        return examples.length
          ? [{ call: key.slice(prefix.length), id: task.id, version: task.version, name: task.name, examples }]
          : []
      })
    },
    /** Ответ клиента; false — его никто не ждёт. */
    report(key: string, name: string, result: BuffChatPlugin.TestResult): boolean {
      const waiting = open.get(key)
      if (!waiting || !waiting.names.has(name)) return false
      if (!waiting.results.has(name)) waiting.results.set(name, result)
      if (waiting.results.size === waiting.names.size) waiting.done()
      return true
    },
  }
}

export type Desk = ReturnType<typeof make>
