// Buff (#595, #982): плагины чатов для телефона и веб-клиента. Список и выключатель — как у окна,
// через RPC ядра `buff.chat-plugin`; страница отрисовщика едет частями — кадр канала меньше её.
// Плагины зависят от проекта чата (личная папка проекта), поэтому команды берут каталог сессии,
// а без неё — дом машины.
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { rpc, str, type Kit, type Ops } from "./api-kit.js"
import { phoneRefusal } from "./refusal.js"

/**
 * Сколько знаков страницы в одной части. Знак в UTF-8 — до трёх байт, так что часть заведомо
 * меньше кадра канала (256 КиБ) вместе с обёрткой ответа.
 */
export const VIEW_PART = 64 * 1024

const HIGH_SURROGATE = /[\uD800-\uDBFF]$/

export function pluginOps(kit: Kit): Ops {
  const where = async (args: Record<string, unknown>) =>
    typeof args.session === "string" && args.session.trim()
      ? kit.directoryOf(args.session.trim())
      : (await kit.home()).directory
  const call = async <T>(args: Record<string, unknown>, method: string, input?: unknown) =>
    rpc<T>(kit, await where(args), "buff.chat-plugin", method, input)
  return {
    // The list is in the client's language (`lang` of every command): a plugin's own labels name
    // it for people; the labels themselves stay on the machine.
    "plugins.list": async (args) => ({
      plugins: ((await call<{ plugins: BuffChatPlugin.Entry[] } | undefined>(args, "list"))?.plugins ?? []).map(
        (entry) => {
          const { labels: _labels, ...shown } = BuffChatPlugin.localized(entry, typeof args.lang === "string" ? args.lang : "en")
          return shown
        },
      ),
    }),
    "plugins.read": async (args) => {
      const id = str(args, "id")
      const from = args.from === undefined ? 0 : args.from
      const view = await call<{ html: string; version: string }>(args, "view", { id })
      if (typeof from !== "number" || !Number.isInteger(from) || from < 0 || from > view.html.length)
        throw phoneRefusal("No such part of the file")
      if (from === view.html.length && from > 0) throw phoneRefusal("No such part of the file")
      const whole = view.html.slice(from, from + VIEW_PART)
      // Пара суррогатов не делится между частями: вторая половина уедет со следующей.
      const text = HIGH_SURROGATE.test(whole) && from + whole.length < view.html.length ? whole.slice(0, -1) : whole
      const next = from + text.length
      return { id, version: view.version, from, text, ...(next < view.html.length ? { next } : {}) }
    },
    "plugins.example": async (args) =>
      call<{ block: string; text: string }>(args, "example", { id: str(args, "id"), name: str(args, "name") }),
    "plugins.enable": async (args) => {
      if (typeof args.enabled !== "boolean") throw phoneRefusal("The field {key} is required", { key: "enabled" })
      await call(args, "enable", { id: str(args, "id"), enabled: args.enabled })
      return {}
    },
    // Живая проверка плагина (#984): клиент нарисовал пример и говорит, что вышло.
    "plugins.report": async (args) => {
      const session = str(args, "session")
      if (typeof args.ok !== "boolean") throw phoneRefusal("The field {key} is required", { key: "ok" })
      await call(args, "report", {
        session,
        call: str(args, "call"),
        example: str(args, "example"),
        ok: args.ok,
        ...(typeof args.error === "string" && args.error.trim() ? { error: args.error.trim().slice(0, 2000) } : {}),
        ...(typeof args.height === "number" && Number.isFinite(args.height) ? { height: args.height } : {}),
      })
      return {}
    },
    "plugins.context": async (args) => {
      const session = str(args, "session")
      const text = typeof args.text === "string" && args.text.trim() ? args.text.trim() : undefined
      await call(args, "context", {
        session,
        frame: str(args, "frame"),
        id: str(args, "id"),
        ...(text ? { text } : {}),
      })
      return {}
    },
  }
}
