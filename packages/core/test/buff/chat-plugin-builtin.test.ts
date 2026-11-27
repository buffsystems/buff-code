// Встроенный плагин графиков (#595, #985): сделан тем же механизмом, что и плагины человека,
// и проходит те же проверки формата.
import { describe, expect, test } from "bun:test"
import vm from "node:vm"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { BuffChatPluginStore } from "../../src/buff/chat-plugin"
import { BuffChatPluginBuiltin } from "../../src/buff/chat-plugin/builtin/index"

const { charts } = BuffChatPluginBuiltin
const entry = BuffChatPluginStore.load(charts.id, "builtin", charts.files)
const guide = charts.files["GUIDE.md"]!
const references = BuffChatPlugin.referencesOf(charts.files)

/** Блоки ```chart и ```json из текста инструкции — её примеры. */
const blocks = (markdown: string) =>
  [...markdown.matchAll(/```(?:chart|json)\n([\s\S]*?)\n```/g)].map((match) => match[1]!)

describe("the built-in charts plugin", () => {
  test("is a whole plugin by the same rules as a person's own", () => {
    expect(entry.problem).toBeUndefined()
    expect(entry.blocks).toEqual(["chart"])
    expect(entry.text).toBe(true)
    expect(entry.examples.length).toBeGreaterThanOrEqual(3)
    expect(entry.description.length).toBeLessThanOrEqual(BuffChatPlugin.LIMITS.descriptionChars)
  })
  test("its view carries the chart library inside and names no web address to load", () => {
    const view = charts.files["view.html"]!
    expect(view.includes("Licensed to the Apache Software Foundation")).toBe(true)
    expect(view.includes("/*@echarts*/")).toBe(false)
    expect(Buffer.byteLength(view)).toBeLessThan(BuffChatPlugin.LIMITS.viewBytes)
    // The library's own text mentions addresses in comments and constants; none is fetched —
    // the frame's policy forbids every request. Our own code names none.
    const ours = view.slice(view.lastIndexOf("<script>"))
    expect(BuffChatPlugin.webAddresses(ours)).toEqual([])
    expect(view.match(/<\/script>/g)).toHaveLength(2)
  })
  test("it paints only with the app's variables: no colour of its own", () => {
    const view = charts.files["view.html"]!
    const ours = view.slice(0, view.indexOf("/*")) + view.slice(view.lastIndexOf("<script>"))
    expect(ours).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    // The one colour it writes is a mix of two of the app's own, for a scale and for ink on a fill.
    expect(ours.match(/\brgba?\(/g)).toHaveLength(1)
    expect(ours).toContain("return 'rgb(' + [0, 1, 2].map")
    // Checked on our own part of the page: a miss must not print the megabyte of the library.
    for (const name of ["'--chart-' + slot", "--chart-axis", "--chart-grid", "--color-text-primary", "--font-sans"])
      expect(ours.includes(name)).toBe(true)
  })
})

describe("what the model reads about charts, and when", () => {
  test("the main guide is short and sends the model to a reference for every other form", () => {
    expect(guide.length).toBeLessThan(6000)
    expect(references.map((reference) => reference.name)).toEqual([
      "flow",
      "forms",
      "hierarchy",
      "radial",
      "share",
      "stats",
      "xy",
    ])
    for (const reference of references) expect(guide).toContain(`guide/${reference.name}.md`)
  })
  test("references are one level deep: none sends the model to a file that does not exist", () => {
    const known = new Set(references.map((reference) => `guide/${reference.name}.md`))
    for (const reference of references) {
      const text = charts.files[`guide/${reference.name}.md`]!
      for (const [pointed] of text.matchAll(/guide\/[a-z-]+\.md/g)) expect(known.has(pointed)).toBe(true)
      expect(reference.title).not.toBe(reference.name)
    }
  })
  test("every example in the guide, the references and the examples folder is valid JSON with series — or names a form the plugin draws itself", () => {
    const texts = [guide, ...references.map((reference) => charts.files[`guide/${reference.name}.md`]!)]
    const found = texts.flatMap(blocks)
    expect(found.length).toBeGreaterThan(20)
    for (const block of found) {
      const option = JSON.parse(block) as { series?: unknown[]; buff?: { form?: string } }
      const drawn = ["gantt", "venn", "wordcloud"].includes(option.buff?.form ?? "")
      expect(drawn || (Array.isArray(option.series) && option.series.length > 0)).toBe(true)
    }
    for (const name of entry.examples) {
      const example = BuffChatPlugin.exampleOf(charts.files[`examples/${name}.md`]!)!
      expect(example.block).toBe("chart")
      expect(JSON.parse(example.text)).toHaveProperty("series")
    }
  })
  test("no example paints with its own colours — the theme does", () => {
    const texts = [guide, ...references.map((reference) => charts.files[`guide/${reference.name}.md`]!)]
    for (const block of texts.flatMap(blocks)) {
      expect(block).not.toMatch(/#[0-9a-f]{6}\b/i)
      expect(JSON.parse(block)).not.toHaveProperty("color")
    }
  })
})

describe("the console's form of a chart", () => {
  const text = (data: string, width = 60) =>
    vm.runInNewContext(`${charts.files["text.js"]}\ntext(data, options)`, { data, options: { width } }) as string
  test("a title and the numbers as a table", () => {
    const out = text(BuffChatPlugin.exampleOf(charts.files["examples/line.md"]!)!.text)
    expect(out.split("\n")[0]).toBe("Выручка по месяцам")
    expect(out).toContain("2025")
    expect(out).toContain("Янв")
    expect(out).toContain("12.1")
    for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(60)
  })
  test("named items and flows are listed; a block that is not JSON comes back as it is", () => {
    expect(text(BuffChatPlugin.exampleOf(charts.files["examples/donut.md"]!)!.text)).toContain("Альфа")
    expect(text(BuffChatPlugin.exampleOf(charts.files["examples/sankey.md"]!)!.text)).toContain("Поиск → Сайт")
    expect(text("not json")).toBe("not json")
    // The forms the plugin draws itself (#985) have their text too.
    const forms = charts.files["guide/forms.md"]!
    const blocks = [...forms.matchAll(/```chart\n([\s\S]*?)\n```/g)].map((match) => match[1]!)
    expect(blocks).toHaveLength(3)
    expect(text(blocks[0]!, 80)).toMatch(/Исследование\s+│ 2026-03-02 │ 2026-03-13 │ 100%/)
    expect(text(blocks[0]!, 80)).toMatch(/Релиз\s+│ 2026-05-18 │ ◆/)
    expect(text(blocks[1]!)).toContain("Python ∩ SQL")
    expect(text(blocks[2]!).split("\n")[2]).toContain("доставка")
  })
})
