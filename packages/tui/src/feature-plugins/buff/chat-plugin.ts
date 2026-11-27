import vm from "node:vm"
import { BoxRenderable, StyledText, TextRenderable, type MarkdownCodeBlockRenderer, type RGBA } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { t } from "./locale"

/**
 * Плагины чатов в консоли (#595, #985). Рамку с отрисовщиком терминал показать не может,
 * поэтому блок плагина здесь — текст: сценарий `text.js` плагина превращает содержимое блока
 * в строки (таблицу, диаграмму символами). Сценарий исполняется в отдельном пустом контексте
 * с ограничением времени — ни файлов, ни сети, ни самой консоли он не видит. Плагин без
 * сценария оставляет обычный блок кода и строку о том, где его визуализацию видно.
 */

/** Сколько сценарию дано на один блок: он строит строку из данных, а не считает. */
const TEXT_TIMEOUT_MS = 200

/** Текст блока по сценарию плагина; не вышло или вышло пусто — ничего. */
export function textOf(js: string, data: string, width: number): string | undefined {
  try {
    const out: unknown = vm.runInNewContext(
      `${js}\n;text(__data, __options)`,
      // Ничего, кроме данных: даже `console` у сценария нет — он писал бы поверх экрана.
      { __data: data, __options: { width }, console: undefined },
      { timeout: TEXT_TIMEOUT_MS },
    )
    return typeof out === "string" && out.trim() && out !== data ? out : undefined
  } catch {
    return undefined
  }
}

type Drawn = { readonly name: string; readonly js?: string }

/** Блоки включённых плагинов: чей он и есть ли у плагина текст для консоли. */
export async function drawnBlocks(
  list: () => Promise<{ readonly plugins: readonly BuffChatPlugin.Entry[] }>,
  script: (id: string) => Promise<{ readonly js: string }>,
): Promise<Map<string, Drawn>> {
  const { plugins } = await list()
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const scripts = new Map<string, string | undefined>()
  const drawn = new Map<string, Drawn>()
  for (const [block, id] of Object.entries(BuffChatPlugin.owners(plugins))) {
    const plugin = byId.get(id)
    if (!plugin) continue
    if (plugin.text && !scripts.has(id))
      scripts.set(
        id,
        await script(id).then(
          (got) => got.js,
          () => undefined,
        ),
      )
    const js = scripts.get(id)
    drawn.set(block, { name: plugin.name, ...(js ? { js } : {}) })
  }
  return drawn
}

export default Plugin.define({
  id: "buff.chat-plugin",
  setup(context) {
    const rpc = context.client.rpc(BuffChatPlugin.Rpc)
    const at = () => ({ location: context.location })
    let registered: Array<() => void> = []

    const lines = (text: string, color: RGBA) => {
      const rows = text.split("\n")
      return new TextRenderable(context.renderer, {
        content: new StyledText(
          rows.map((row, index) => ({
            __isChunk: true as const,
            text: index < rows.length - 1 ? row + "\n" : row,
            fg: color,
          })),
        ),
        width: "100%",
        height: rows.length,
        wrapMode: "none",
        marginTop: 1,
        flexShrink: 0,
      })
    }

    const renderer =
      (block: Drawn): MarkdownCodeBlockRenderer =>
      (token, node) => {
        const code = node.defaultRender() ?? undefined
        if (block.js) {
          // Блок, который ещё набирается или не разбирается, остаётся кодом.
          const width = Math.max(20, Math.trunc(context.renderer.width) - 6)
          const text = textOf(block.js, token.text, width)
          return text === undefined ? code : lines(text, context.theme.text.base)
        }
        // У плагина нет текста для консоли: код как есть и строка о том, где его видно.
        if (!code) return undefined
        const box = new BoxRenderable(context.renderer, { flexDirection: "column", width: "100%", flexShrink: 0 })
        box.add(code)
        box.add(
          lines(
            t("The visual «{name}» is drawn in the window, on the web and on the phone.", { name: block.name }),
            context.theme.text.muted,
          ),
        )
        return box
      }

    const refresh = async () => {
      const drawn = await drawnBlocks(
        () => rpc.list(undefined, at()),
        (id) => rpc.script({ id }, at()),
      ).catch(() => new Map<string, Drawn>())
      registered.forEach((off) => off())
      registered = [...drawn].flatMap(([name, block]) => {
        try {
          return [context.markdown.registerCodeBlockRenderer(name, renderer(block))]
        } catch {
          // Имя занято другим отрисовщиком консоли (mermaid, latex): он и остаётся.
          return []
        }
      })
    }

    const stop = new AbortController()
    void refresh()
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) void refresh()
    })().catch(() => undefined)
    return () => {
      stop.abort()
      registered.forEach((off) => off())
    }
  },
})
