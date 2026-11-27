// Плагины чатов (#595, #979): формат папки плагина, владельцы блоков, инструкции для модели.
import { describe, expect, test } from "bun:test"
import { BuffChatPlugin } from "../src/buff-chat-plugin.js"
import { BuffI18n } from "../src/buff-i18n.js"

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "Charts", description: "Draws charts from numbers", blocks: ["chart"], ...over })

const entry = (over: Partial<BuffChatPlugin.Entry> = {}): BuffChatPlugin.Entry => ({
  id: "charts",
  name: "Charts",
  description: "Draws charts",
  blocks: ["chart"],
  origin: "user",
  version: "v1",
  enabled: true,
  text: false,
  examples: [],
  ...over,
})

describe("the plugin description file", () => {
  test("a complete file is read as it is", () => {
    expect(BuffChatPlugin.manifestOf(manifest())).toEqual({
      manifest: { name: "Charts", description: "Draws charts from numbers", blocks: ["chart"] },
    })
  })
  test("broken JSON, a missing name, description or block is a problem in plain words", () => {
    expect(BuffChatPlugin.manifestOf("{")).toHaveProperty("problem")
    expect(BuffChatPlugin.manifestOf(manifest({ name: " " }))).toHaveProperty("problem")
    expect(BuffChatPlugin.manifestOf(manifest({ description: "" }))).toHaveProperty("problem")
    expect(BuffChatPlugin.manifestOf(manifest({ blocks: [] }))).toHaveProperty("problem")
  })
  test("a plugin may name itself for people in their languages; the model's description stays", () => {
    const read = BuffChatPlugin.manifestOf(
      manifest({
        labels: {
          ru: { name: " Графики ", summary: "Графики по числам" },
          "pt-BR": { name: "Gráficos" },
          "not a locale": { name: "x" },
          de: { name: 7 },
          en: "Charts",
        },
      }),
    )
    if (!("manifest" in read)) throw new Error("no manifest")
    expect(read.manifest.labels).toEqual({
      ru: { name: "Графики", summary: "Графики по числам" },
      "pt-BR": { name: "Gráficos" },
    })
    const entry = { ...read.manifest, id: "charts" }
    expect(BuffChatPlugin.localized(entry, "ru")).toMatchObject({ name: "Графики", description: "Графики по числам" })
    // The exact language, then its base; a part the label lacks stays as described.
    expect(BuffChatPlugin.localized(entry, "ru-RU").name).toBe("Графики")
    expect(BuffChatPlugin.localized(entry, "pt-BR")).toMatchObject({ name: "Gráficos", description: "Draws charts from numbers" })
    expect(BuffChatPlugin.localized(entry, "fr")).toBe(entry)
    expect(BuffChatPlugin.manifestOf(manifest({ labels: "ru" }))).toEqual({
      manifest: { name: "Charts", description: "Draws charts from numbers", blocks: ["chart"] },
    })
  })
  test("a block name is a lowercase word: it becomes the language of a code block", () => {
    for (const bad of ["Chart", "my chart", "1chart", "chart!", ""])
      expect(BuffChatPlugin.manifestOf(manifest({ blocks: [bad] }))).toHaveProperty("problem")
    for (const good of ["chart", "sales-map", "data_visualisation", "kpi2"])
      expect(BuffChatPlugin.manifestOf(manifest({ blocks: [good] }))).toHaveProperty("manifest")
  })
  test("a plugin may name the usual height of its visual; nonsense is dropped", () => {
    expect(BuffChatPlugin.manifestOf(manifest({ height: 356.4 }))).toMatchObject({ manifest: { height: 356 } })
    for (const bad of [0, -5, 5000, "tall"])
      expect(BuffChatPlugin.manifestOf(manifest({ height: bad }))).not.toHaveProperty("manifest.height")
  })
  test("the same block listed twice is kept once", () => {
    expect(BuffChatPlugin.manifestOf(manifest({ blocks: ["chart", "chart", "table"] }))).toEqual({
      manifest: { name: "Charts", description: "Draws charts from numbers", blocks: ["chart", "table"] },
    })
  })
  test("the id is the folder name: lowercase Latin letters, digits and hyphen", () => {
    expect(BuffChatPlugin.idProblem("sales-map")).toBeUndefined()
    for (const bad of ["Sales", "sales map", "-a", "", "../x", "a/b"])
      expect(BuffChatPlugin.idProblem(bad)).toBeString()
  })
})

describe("who draws a block", () => {
  test("only enabled plugins without a problem own their blocks", () => {
    const owners = BuffChatPlugin.owners([
      entry(),
      entry({ id: "off", blocks: ["map"], enabled: false }),
      entry({ id: "broken", blocks: ["gantt"], problem: "no view" }),
    ])
    expect(owners).toEqual({ chart: "charts" })
  })
  test("a block claimed twice goes to the built-in one, then to the first by id", () => {
    const owners = BuffChatPlugin.owners([
      entry({ id: "a-mine", blocks: ["chart", "map"] }),
      entry({ id: "z-builtin", origin: "builtin", blocks: ["chart"] }),
      entry({ id: "b-mine", blocks: ["map"] }),
    ])
    expect(owners).toEqual({ chart: "z-builtin", map: "a-mine" })
  })
})

describe("a plugin is a skill with a visual: the model loads it step by step", () => {
  const templates = {
    description: "{{description}} Draws {{blocks}}.",
    references: "## More\n\n{{items}}\n---item---\n- `{{path}}` — {{title}}",
  }
  const files = {
    "GUIDE.md": "Write JSON with `type`. For maps read guide/map.md.",
    "guide/map.md": "# Maps: regions, points, routes\n\nLong text.",
    "guide/flow.md": "No heading here.",
    "view.html": "<p>",
  }
  const skill = (over: Partial<BuffChatPlugin.Entry> = {}, owned: Record<string, string> = { chart: "charts" }) =>
    BuffChatPlugin.skillOf({
      entry: entry(over),
      guide: files["GUIDE.md"],
      directory: "/cfg/chat-plugins/charts",
      files,
      owned,
      templates,
    })

  test("always in the prompt: only the name and what it draws and when", () => {
    expect(skill()).toMatchObject({ id: "visual-charts", name: "Charts", description: "Draws charts Draws `chart`." })
  })
  test("loaded when needed: the guide, then where each reference lies and what it is about", () => {
    const content = skill()!.content
    expect(content).toStartWith("Write JSON with `type`.")
    expect(content).toContain("- `/cfg/chat-plugins/charts/guide/flow.md` — flow")
    expect(content).toContain("- `/cfg/chat-plugins/charts/guide/map.md` — Maps: regions, points, routes")
    expect(content).not.toContain("Long text.")
    expect(content).not.toContain("{{")
  })
  test("a plugin without references adds nothing to its guide", () => {
    const plain = BuffChatPlugin.skillOf({
      entry: entry(),
      guide: "Just this.",
      directory: "/d",
      files: { "GUIDE.md": "Just this." },
      owned: { chart: "charts" },
      templates,
    })
    expect(plain!.content).toBe("Just this.")
  })
  test("a plugin that is off, broken, or draws no block of its own is no skill", () => {
    expect(skill({ enabled: false })).toBeUndefined()
    expect(skill({ problem: "no view" })).toBeUndefined()
    expect(skill({}, { chart: "another" })).toBeUndefined()
  })
  test("it names only the blocks it owns", () => {
    expect(skill({ blocks: ["chart", "pie"] }, { chart: "charts", pie: "other" })!.description).toBe(
      "Draws charts Draws `chart`.",
    )
  })
  test("such skills are told apart by their id", () => {
    expect(BuffChatPlugin.isPluginSkill("visual-charts")).toBe(true)
    expect(BuffChatPlugin.isPluginSkill("release-notes")).toBe(false)
  })
})

describe("an example of a block", () => {
  test("is a Markdown file with one code block, exactly as the model writes it in a chat", () => {
    expect(BuffChatPlugin.exampleOf('Sales by year\n\n```chart\n{"type":"bar"}\n```\n')).toEqual({
      block: "chart",
      text: '{"type":"bar"}',
    })
    expect(BuffChatPlugin.exampleOf("````map extra\nline 1\n```\nline 3\n````")).toEqual({
      block: "map",
      text: "line 1\n```\nline 3",
    })
  })
  test("a file without a named code block is not an example", () => {
    expect(BuffChatPlugin.exampleOf("just text")).toBeUndefined()
    expect(BuffChatPlugin.exampleOf("```\nno name\n```")).toBeUndefined()
    expect(BuffChatPlugin.exampleOf("```chart\nnever closed")).toBeUndefined()
  })
})

describe("what a visual tells the model", () => {
  const template = "The user set:\n\n{{items}}\n---item---\n- {{plugin}}: {{text}}"
  test("each visual's state is a line under its plugin's name", () => {
    expect(
      BuffChatPlugin.contextText(template, [
        { plugin: "Charts", text: " Year: 2025 " },
        { plugin: "Map", text: "Region: North" },
      ]),
    ).toBe("The user set:\n\n- Charts: Year: 2025\n- Map: Region: North")
  })
  test("nothing set — nothing said", () => {
    expect(BuffChatPlugin.contextText(template, [])).toBeUndefined()
  })
})

describe("a plugin the model saves", () => {
  const input = {
    id: "sales-map",
    name: "Sales map",
    description: "Shows sales on a map",
    blocks: ["sales-map"],
    view: "<div id=map></div>",
    guide: "One region per line.",
    text: "",
    examples: [{ name: "regions", block: "```sales-map\nNorth: 10\n```" }],
  }
  test("becomes the files of its folder", () => {
    expect(BuffChatPlugin.folderOf(input)).toEqual({
      files: {
        "plugin.json": JSON.stringify(
          { name: "Sales map", description: "Shows sales on a map", blocks: ["sales-map"] },
          null,
          2,
        ),
        "view.html": "<div id=map></div>",
        "GUIDE.md": "One region per line.",
        "examples/regions.md": "```sales-map\nNorth: 10\n```",
      },
    })
    const withText = BuffChatPlugin.folderOf({ ...input, text: "function text(d) { return d }" })
    expect("files" in withText && withText.files["text.js"]).toBe("function text(d) { return d }")
  })
  test("is refused with the reason when something is missing or misnamed", () => {
    const problem = (over: Record<string, unknown>) => {
      const got = BuffChatPlugin.folderOf({ ...input, ...over } as typeof input)
      return "problem" in got ? got.problem : undefined
    }
    expect(problem({ id: "Sales Map" })).toBeString()
    expect(problem({ blocks: ["Sales"] })).toBeString()
    expect(problem({ view: " " })).toBeString()
    expect(problem({ guide: "" })).toBeString()
    expect(problem({ examples: [] })).toContain("example")
    expect(problem({ examples: [{ name: "bad name", block: input.examples[0]!.block }] })).toBeString()
    expect(problem({ examples: [{ name: "x", block: "no fence" }] })).toContain("code block")
    expect(problem({ examples: [{ name: "x", block: "```other\n1\n```" }] })).toContain("sales-map")
    expect(problem({})).toBeUndefined()
  })
  test("references ride along when the guide points to them", () => {
    const withRefs = BuffChatPlugin.folderOf({
      ...input,
      guide: "Basics here. For routes read guide/routes.md.",
      references: [{ name: "routes", text: "# Routes\n\nDetails." }],
    })
    expect("files" in withRefs && withRefs.files["guide/routes.md"]).toBe("# Routes\n\nDetails.")
    const orphan = BuffChatPlugin.folderOf({ ...input, references: [{ name: "routes", text: "x" }] })
    expect("problem" in orphan && orphan.problem).toContain("never points to guide/routes.md")
    const empty = BuffChatPlugin.folderOf({
      ...input,
      guide: "See guide/routes.md",
      references: [{ name: "routes", text: " " }],
    })
    expect("problem" in empty && empty.problem).toContain("empty")
  })
  test("a description too long for the prompt is refused", () => {
    const long = BuffChatPlugin.folderOf({
      ...input,
      description: "x".repeat(BuffChatPlugin.LIMITS.descriptionChars + 1),
    })
    expect("problem" in long && long.problem).toContain("prompt")
  })
  test("the person confirms it in their language", () => {
    const ru = (text: string, params?: Record<string, string | number>) => BuffI18n.t("ru", text, params as never)
    expect(BuffChatPlugin.saveConfirmation({ ...input, scope: "user" }, ru)).toEqual([
      "Сохранить плагин чатов «Sales map» для: все проекты",
      "Рисует блоки: sales-map",
      "Когда нужен: Shows sales on a map",
    ])
    expect(BuffChatPlugin.saveConfirmation({ ...input, scope: "local", project: "shop" }, ru)[0]).toBe(
      "Сохранить плагин чатов «Sales map» для: только проект «shop»",
    )
  })
})

describe("web addresses in a view", () => {
  test("are found wherever they stand: they will never load, the author should know", () => {
    const view = `<script src="https://cdn.example.com/lib.js"></script>
      <img src='//img.example.org/a.png'><style>body{background:url(http://x.example/bg.png)}</style>
      <script>fetch("https://api.example.com/data")</script>`
    expect(BuffChatPlugin.webAddresses(view)).toEqual([
      "https://cdn.example.com/lib.js",
      "//img.example.org/a.png",
      "http://x.example/bg.png",
      "https://api.example.com/data",
    ])
  })
  test("a namespace of the markup itself is not an address to fetch", () => {
    expect(BuffChatPlugin.webAddresses(`document.createElementNS("http://www.w3.org/2000/svg", "svg") // a/b`)).toEqual(
      [],
    )
  })
})

describe("a live test of a plugin", () => {
  const test1 = {
    id: "sales-map",
    version: "v1",
    name: "Sales map",
    examples: [{ name: "regions", block: "sales-map", text: "North: 10" }],
  }
  test("travels in the running call's metadata and is read back by a client", () => {
    expect(BuffChatPlugin.testOf({ [BuffChatPlugin.TEST_KEY]: test1 })).toEqual(test1)
    expect(BuffChatPlugin.testOf({})).toBeUndefined()
    expect(BuffChatPlugin.testOf({ [BuffChatPlugin.TEST_KEY]: { id: 1 } })).toBeUndefined()
    expect(BuffChatPlugin.testOf(undefined)).toBeUndefined()
  })
  test("the model is told what drew, what failed and what nobody answered for", () => {
    const text = BuffChatPlugin.testText(
      ["regions", "empty", "big"],
      new Map([
        ["regions", { ok: true, height: 240 }],
        ["empty", { ok: false, error: "Cannot read properties of undefined" }],
      ]),
    )
    expect(text).toContain("regions: drawn, 240 px high")
    expect(text).toContain("empty: FAILED — Cannot read properties of undefined")
    expect(text).toContain("big: no answer")
    expect(text).toContain("Fix")
  })
  test("all drawn — say so and what to do next; nobody answered — do not claim success", () => {
    expect(BuffChatPlugin.testText(["a"], new Map([["a", { ok: true, height: 80 }]]))).toContain("All examples drew")
    const silent = BuffChatPlugin.testText(["a"], new Map())
    expect(silent).toContain("no answer")
    expect(silent).not.toContain("All examples drew")
    expect(silent).toContain("ask the user")
  })
})
