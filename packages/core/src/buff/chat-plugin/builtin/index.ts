/// <reference path="../../../chat-plugin-assets.d.ts" />
export * as BuffChatPluginBuiltin from "./index.js"

import type { BuffChatPluginStore } from "../../chat-plugin.js"
import chartsBars from "./charts/examples/bars.md" with { type: "text" }
import chartsDonut from "./charts/examples/donut.md" with { type: "text" }
import chartsLine from "./charts/examples/line.md" with { type: "text" }
import chartsSankey from "./charts/examples/sankey.md" with { type: "text" }
import chartsGuide from "./charts/GUIDE.md" with { type: "text" }
import chartsFlow from "./charts/guide/flow.md" with { type: "text" }
import chartsForms from "./charts/guide/forms.md" with { type: "text" }
import chartsHierarchy from "./charts/guide/hierarchy.md" with { type: "text" }
import chartsRadial from "./charts/guide/radial.md" with { type: "text" }
import chartsShare from "./charts/guide/share.md" with { type: "text" }
import chartsStats from "./charts/guide/stats.md" with { type: "text" }
import chartsXy from "./charts/guide/xy.md" with { type: "text" }
import chartsManifest from "./charts/plugin.json.txt" with { type: "text" }
import chartsText from "./charts/text.js.txt" with { type: "text" }
import chartsView from "./charts/view.html.txt" with { type: "text" }
// Apache ECharts (Apache-2.0) goes into the view whole: a plugin's frame fetches nothing.
import echarts from "echarts/dist/echarts.min.js" with { type: "text" }

/**
 * Плагины чатов, встроенные в Buff Code (#595, #985). Они сделаны тем же механизмом, что и
 * плагины человека, — та же папка, тот же мостик, те же переменные дизайн-системы, — и
 * отличаются только тем, что едут вместе с программой.
 *
 * `charts` — графики на Apache ECharts: блок `chart` несёт его `option` как JSON, а вид
 * целиком задаёт тема из переменных приложения. Библиотека вписана в страницу отрисовщика:
 * сети у рамки нет.
 */
const ECHARTS_SLOT = "/*@echarts*/"

/** Страница отрисовщика с библиотекой внутри; закрывающий тег скрипта в ней встретиться не должен. */
export function withLibrary(view: string, library: string): string {
  if (!view.includes(ECHARTS_SLOT)) throw new Error("The charts view has no place for the library")
  return view.replace(ECHARTS_SLOT, () => library.replace(/<\/script/gi, "<\\/script"))
}

export const charts: BuffChatPluginStore.Builtin = {
  id: "charts",
  files: {
    "plugin.json": chartsManifest,
    "view.html": withLibrary(chartsView, echarts),
    "GUIDE.md": chartsGuide,
    "text.js": chartsText,
    "guide/xy.md": chartsXy,
    "guide/share.md": chartsShare,
    "guide/radial.md": chartsRadial,
    "guide/hierarchy.md": chartsHierarchy,
    "guide/flow.md": chartsFlow,
    "guide/stats.md": chartsStats,
    "guide/forms.md": chartsForms,
    "examples/line.md": chartsLine,
    "examples/bars.md": chartsBars,
    "examples/donut.md": chartsDonut,
    "examples/sankey.md": chartsSankey,
  },
}

export const all: readonly BuffChatPluginStore.Builtin[] = [charts]
