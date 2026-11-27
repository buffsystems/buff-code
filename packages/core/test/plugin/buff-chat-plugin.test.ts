// Плагины чатов (#595, #979): ядро читает папки плагинов, отдаёт список и отрисовщик,
// выключает плагин, не трогая папку, и рассказывает модели о включённых.
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { Skill } from "@opencode/core/skill"
import { BuffChatPluginStore } from "@opencode/core/buff/chat-plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const files = (over: Record<string, string | undefined> = {}): Record<string, string> => {
  const all: Record<string, string | undefined> = {
    "plugin.json": JSON.stringify({ name: "Sales map", description: "Shows sales on a map", blocks: ["sales-map"] }),
    "view.html": "<div id=map></div><script>buff.onBlock(() => {})</script>",
    "GUIDE.md": "Write one region per line: `name: amount`.",
    "examples/regions.md": "```sales-map\nNorth: 10\n```\n",
    ...over,
  }
  return Object.fromEntries(Object.entries(all).filter((pair): pair is [string, string] => pair[1] !== undefined))
}

const put = (root: string, id: string, content: Record<string, string>) =>
  Effect.promise(async () => {
    for (const [name, text] of Object.entries(content)) {
      const file = path.join(root, BuffChatPlugin.DIR, id, name)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, text)
    }
  })

const setup = (builtins: readonly BuffChatPluginStore.Builtin[] = [], inProject = true, at?: string) =>
  Effect.gen(function* () {
    // `at` — a configuration folder that is already there: the program started again over it.
    const user =
      at ??
      (yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "buff-chat-plugin-"))),
        (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
      ))
    const personal = path.join(user, "projects", "prj_one")
    const host = yield* PluginHost.make(yield* Plugin.Service, "buff.chat-plugin")
    const store = yield* BuffChatPluginStore.register(host, {
      userDirectory: user,
      localDirectory: inProject ? personal : undefined,
      builtins,
      testWait: 300,
    })
    const registry = yield* Skill.Service
    /** Навыки плагинов, какими их видит модель: всегда в промпте — только id, имя и описание. */
    const visuals = registry
      .list()
      .pipe(Effect.map((skills) => skills.filter((skill) => BuffChatPlugin.isPluginSkill(skill.id))))
    return { rpc: (yield* Rpc.Service).client(BuffChatPlugin.Rpc), store, user, personal, visuals }
  })

describe("BuffChatPlugin (#979)", () => {
  it.live("a plugin folder in the user's configuration is listed with its blocks, examples and a version", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup()
      yield* put(user, "sales-map", files({ "text.js": "function text(data) { return data }" }))
      const { plugins } = yield* rpc.list()
      expect(plugins).toEqual([
        {
          id: "sales-map",
          name: "Sales map",
          description: "Shows sales on a map",
          blocks: ["sales-map"],
          origin: "user",
          version: plugins[0]!.version,
          enabled: true,
          text: true,
          examples: ["regions"],
        },
      ])
      expect(plugins[0]!.version).toMatch(/^[0-9a-f]{16}$/)
    }),
  )

  it.live("the version changes when any file of the plugin changes, and only then", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup()
      yield* put(user, "sales-map", files())
      const before = (yield* rpc.list()).plugins[0]!.version
      expect((yield* rpc.list()).plugins[0]!.version).toBe(before)
      yield* put(user, "sales-map", { "view.html": "<p>new</p>" })
      expect((yield* rpc.list()).plugins[0]!.version).not.toBe(before)
    }),
  )

  it.live("the view and an example are handed out as they lie in the folder", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup()
      yield* put(user, "sales-map", files())
      const listed = (yield* rpc.list()).plugins[0]!
      expect(yield* rpc.view({ id: "sales-map" })).toEqual({ html: files()["view.html"]!, version: listed.version })
      expect(yield* rpc.example({ id: "sales-map", name: "regions" })).toEqual({
        block: "sales-map",
        text: "North: 10",
      })
      expect(yield* rpc.view({ id: "nope" }).pipe(Effect.flip)).toMatchObject({ type: "invalid" })
      expect(yield* rpc.example({ id: "sales-map", name: "nope" }).pipe(Effect.flip)).toMatchObject({ type: "invalid" })
    }),
  )

  it.live("the console's text script is handed out for a plugin that has one", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup()
      yield* put(user, "sales-map", files({ "text.js": "function text(data) { return data }" }))
      yield* put(
        user,
        "plain",
        files({
          "plugin.json": JSON.stringify({ name: "P", description: "d", blocks: ["plain"] }),
          "examples/regions.md": "```plain\nx\n```",
        }),
      )
      expect((yield* rpc.script({ id: "sales-map" })).js).toBe("function text(data) { return data }")
      expect(yield* rpc.script({ id: "plain" }).pipe(Effect.flip)).toMatchObject({ type: "invalid" })
    }),
  )

  it.live("a folder that cannot work is listed with the reason and draws nothing", () =>
    Effect.gen(function* () {
      const { rpc, store, user } = yield* setup()
      yield* put(user, "no-view", files({ "view.html": undefined }))
      yield* put(user, "no-guide", files({ "GUIDE.md": undefined }))
      yield* put(user, "bad-json", files({ "plugin.json": "{" }))
      yield* put(user, "long-guide", files({ "GUIDE.md": "x".repeat(BuffChatPlugin.LIMITS.guideChars + 1) }))
      yield* put(user, "Bad Name", files())
      const { plugins } = yield* rpc.list()
      expect(plugins.map((plugin) => [plugin.id, typeof plugin.problem])).toEqual([
        ["bad-json", "string"],
        ["long-guide", "string"],
        ["no-guide", "string"],
        ["no-view", "string"],
      ])
      expect(BuffChatPlugin.owners(plugins)).toEqual({})
      expect(yield* store.system).toBeUndefined()
      expect(yield* rpc.view({ id: "no-view" }).pipe(Effect.flip)).toMatchObject({ type: "invalid" })
    }),
  )

  it.live("a plugin of this project only lives in the project's personal directory and wins over the user's", () =>
    Effect.gen(function* () {
      const { rpc, user, personal } = yield* setup()
      yield* put(user, "sales-map", files())
      yield* put(personal, "sales-map", files({ "view.html": "<p>project</p>" }))
      const { plugins } = yield* rpc.list()
      expect(plugins.map((plugin) => [plugin.id, plugin.origin])).toEqual([["sales-map", "local"]])
      expect((yield* rpc.view({ id: "sales-map" })).html).toBe("<p>project</p>")
    }),
  )

  it.live("a built-in plugin is listed first-class, cannot be shadowed by a folder and cannot be removed", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup([{ id: "sales-map", files: files({ "view.html": "<p>built in</p>" }) }])
      yield* put(user, "sales-map", files())
      const { plugins } = yield* rpc.list()
      expect(plugins.map((plugin) => [plugin.id, plugin.origin])).toEqual([["sales-map", "builtin"]])
      expect((yield* rpc.view({ id: "sales-map" })).html).toBe("<p>built in</p>")
      expect(yield* rpc.remove({ id: "sales-map" }).pipe(Effect.flip)).toMatchObject({ type: "invalid" })
    }),
  )

  it.live("switching a plugin off keeps the folder, and hides it from the model", () =>
    Effect.gen(function* () {
      const { rpc, store, user, visuals } = yield* setup()
      yield* put(user, "sales-map", files())
      expect(yield* store.system).toContain("Visuals in the chat")
      expect((yield* visuals).map((skill) => String(skill.id))).toEqual(["visual-sales-map"])
      yield* rpc.enable({ id: "sales-map", enabled: false })
      expect((yield* rpc.list()).plugins[0]!.enabled).toBe(false)
      expect(yield* store.system).toBeUndefined()
      expect(yield* visuals).toEqual([])
      yield* rpc.enable({ id: "sales-map", enabled: true })
      expect((yield* visuals).map((skill) => String(skill.id))).toEqual(["visual-sales-map"])
    }),
  )

  it.live("removing an own plugin deletes its folder", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup()
      yield* put(user, "sales-map", files())
      yield* rpc.remove({ id: "sales-map" })
      expect((yield* rpc.list()).plugins).toEqual([])
      expect(yield* Effect.promise(() => fs.readdir(path.join(user, BuffChatPlugin.DIR)))).toEqual([])
    }),
  )

  it.live(
    "a visual's state is told to the model of its chat only, replaced by the next and cleared by an empty one",
    () =>
      Effect.gen(function* () {
        const { rpc, store, user } = yield* setup()
        yield* put(user, "sales-map", files())
        yield* rpc.context({ session: "ses_1", frame: "msg_1:0", id: "sales-map", text: "Region: North" })
        yield* rpc.context({ session: "ses_1", frame: "msg_1:0", id: "sales-map", text: "Region: South" })
        yield* rpc.context({ session: "ses_1", frame: "msg_2:0", id: "sales-map", text: "Year: 2025" })
        const told = store.context("ses_1")
        expect(told).toContain("- Sales map: Region: South")
        expect(told).toContain("- Sales map: Year: 2025")
        expect(told).not.toContain("North")
        expect(store.context("ses_2")).toBeUndefined()
        yield* rpc.context({ session: "ses_1", frame: "msg_1:0", id: "sales-map" })
        yield* rpc.context({ session: "ses_1", frame: "msg_2:0", id: "sales-map", text: " " })
        expect(store.context("ses_1")).toBeUndefined()
      }),
  )

  it.live("a state that is too long, or from a plugin that is not there, is refused", () =>
    Effect.gen(function* () {
      const { rpc, store, user } = yield* setup()
      yield* put(user, "sales-map", files())
      const long = "x".repeat(BuffChatPlugin.LIMITS.contextChars + 1)
      expect(
        yield* rpc.context({ session: "ses_1", frame: "a", id: "sales-map", text: long }).pipe(Effect.flip),
      ).toMatchObject({ type: "invalid" })
      expect(
        yield* rpc.context({ session: "ses_1", frame: "a", id: "nope", text: "x" }).pipe(Effect.flip),
      ).toMatchObject({ type: "invalid" })
      expect(store.context("ses_1")).toBeUndefined()
    }),
  )

  it.live("only the latest visuals of a chat are kept", () =>
    Effect.gen(function* () {
      const { rpc, store, user } = yield* setup()
      yield* put(user, "sales-map", files())
      for (let n = 0; n <= BuffChatPlugin.LIMITS.contextFrames; n++)
        yield* rpc.context({ session: "ses_1", frame: `f${n}`, id: "sales-map", text: `state ${n};` })
      const told = store.context("ses_1")!
      expect(told).not.toContain("state 0;")
      expect(told).toContain("state 1;")
      expect(told).toContain(`state ${BuffChatPlugin.LIMITS.contextFrames};`)
    }),
  )

  // --- плагин для модели — навык: три шага подгрузки ------------------------------------------

  it.live("the prompt holds a line per plugin; the guide and the references are loaded only when needed", () =>
    Effect.gen(function* () {
      const { store, user, visuals } = yield* setup()
      yield* put(
        user,
        "sales-map",
        files({
          "GUIDE.md": "Write one region per line. For routes read guide/routes.md.",
          "guide/routes.md": "# Routes between regions\n\n" + "A long reference. ".repeat(400),
        }),
      )
      const system = (yield* store.system)!
      // Шаг 1 — всегда: общие правила и описание плагина; ни формата, ни справочника.
      expect(system).not.toContain("one region per line")
      expect(system.length).toBeLessThan(2000)
      const [skill] = yield* visuals
      expect(String(skill!.name)).toBe("Sales map")
      expect(skill!.description).toContain("Shows sales on a map")
      expect(skill!.description).toContain("`sales-map`")
      expect(skill!.description!.length).toBeLessThan(1024)
      // Шаг 2 — по запросу модели: инструкция и где лежит каждый справочник.
      expect(skill!.content).toStartWith("Write one region per line.")
      expect(skill!.content).toContain(path.join(user, BuffChatPlugin.DIR, "sales-map", "guide", "routes.md"))
      expect(skill!.content).toContain("Routes between regions")
      // Шаг 3 — сам справочник в навык не попадает: модель читает файл, когда он нужен.
      expect(skill!.content).not.toContain("A long reference.")
      expect(skill!.content.length).toBeLessThan(600)
    }),
  )

  it.live("a hundred plugins cost the prompt a hundred short lines, not a hundred guides", () =>
    Effect.gen(function* () {
      const { store, user, visuals } = yield* setup()
      for (let n = 0; n < 100; n++)
        yield* put(
          user,
          `plugin-${n}`,
          files({
            "plugin.json": JSON.stringify({
              name: `Visual ${n}`,
              description: `Shows thing ${n}`,
              blocks: [`block-${n}`],
            }),
            "GUIDE.md": "A guide of some length. ".repeat(200),
            "examples/regions.md": "```block-" + n + "\nx\n```\n",
          }),
        )
      const rules = (yield* store.system)!
      const offered = yield* visuals
      expect(offered).toHaveLength(100)
      const always = rules.length + offered.reduce((sum, skill) => sum + skill.description!.length, 0)
      const guides = offered.reduce((sum, skill) => sum + skill.content.length, 0)
      expect(always).toBeLessThan(20_000)
      expect(guides).toBeGreaterThan(400_000)
    }),
  )

  // An update of Buff Code brings new built-in plugins; the person's own are theirs and stay.
  it.live("a new version of a built-in plugin replaces only its own folder: the person's plugins stay", () =>
    Effect.gen(function* () {
      // The configuration folder as an older Buff Code left it: its built-in charts, and a plugin of the person's.
      const user = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "buff-chat-plugin-"))),
        (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
      )
      yield* put(user, path.join(".builtin", "charts"), { "GUIDE.md": "Old guide.", "old-only.md": "gone", ".version": "old" })
      yield* put(user, "sales-map", files({ "GUIDE.md": "My own guide." }))
      const own = path.join(user, BuffChatPlugin.DIR, "sales-map", "GUIDE.md")
      const laid = path.join(user, BuffChatPlugin.DIR, ".builtin", "charts")

      const { rpc } = yield* setup([{ id: "charts", files: files({ "GUIDE.md": "New guide." }) }], true, user)
      expect(yield* Effect.promise(() => fs.readFile(path.join(laid, "GUIDE.md"), "utf8"))).toBe("New guide.")
      expect(yield* Effect.promise(() => fs.readdir(laid))).not.toContain("old-only.md")
      expect(yield* Effect.promise(() => fs.readFile(own, "utf8"))).toBe("My own guide.")
      const { plugins } = yield* rpc.list()
      expect(plugins.map((plugin) => [plugin.id, plugin.origin]).toSorted()).toEqual([
        ["charts", "builtin"],
        ["sales-map", "user"],
      ])
    }),
  )

  it.live("a built-in plugin is laid out on disk so its guide and references can be read as files", () =>
    Effect.gen(function* () {
      const builtin = files({ "GUIDE.md": "See guide/xy.md.", "guide/xy.md": "# Lines and bars\n\nDetails." })
      const { user, visuals } = yield* setup([{ id: "charts", files: builtin }])
      const [skill] = yield* visuals
      const reference = path.join(user, BuffChatPlugin.DIR, ".builtin", "charts", "guide", "xy.md")
      expect(skill!.content).toContain(reference)
      expect(yield* Effect.promise(() => fs.readFile(reference, "utf8"))).toBe("# Lines and bars\n\nDetails.")
    }),
  )

  it.live("a file changed on disk is what the model loads next: the registry follows the folder", () =>
    Effect.gen(function* () {
      const { rpc, user, visuals } = yield* setup()
      yield* put(user, "sales-map", files())
      yield* rpc.list()
      expect((yield* visuals)[0]!.content).toContain("Write one region per line")
      yield* put(user, "sales-map", { "GUIDE.md": "New format: JSON." })
      yield* rpc.list()
      expect((yield* visuals)[0]!.content).toBe("New format: JSON.")
    }),
  )

  // --- инструменты режима «Настройка» (#984) ---------------------------------------------------

  const made = {
    id: "funnel",
    name: "Funnel",
    description: "Shows a sales funnel",
    blocks: ["funnel"],
    view: "<div id=f></div><script>buff.onBlock(() => {})</script>",
    guide: "One stage per line: `name: count`.",
    text: "",
    examples: [{ name: "week", block: "```funnel\nVisits: 100\nOrders: 7\n```" }],
    references: [] as { name: string; text: string }[],
  }
  const call = (progress: Array<Record<string, unknown>> = []) => ({
    sessionID: "ses_1",
    agent: "setup",
    messageID: "msg_1",
    id: "call_1",
    progress: (update: Record<string, unknown>) => Effect.sync(() => void progress.push(update)),
  })

  it.live("the model saves a plugin: in a project it is kept for that project only, and it is on at once", () =>
    Effect.gen(function* () {
      const { rpc, store, personal } = yield* setup()
      const text = yield* store.tools.save(made, call())
      expect(text).toContain("this project only")
      expect(text).toContain(path.join(personal, BuffChatPlugin.DIR, "funnel"))
      expect(text).toContain("chat_plugin_test")
      const { plugins } = yield* rpc.list()
      expect(plugins.map((plugin) => [plugin.id, plugin.origin, plugin.enabled, plugin.examples])).toEqual([
        ["funnel", "local", true, ["week"]],
      ])
      expect(yield* store.system).toContain("Visuals in the chat")
    }),
  )

  it.live("outside a project a plugin is saved for all projects; saving again replaces it where it lives", () =>
    Effect.gen(function* () {
      const { rpc, store, user } = yield* setup([], false)
      expect(yield* store.tools.save(made, call())).toContain("all projects")
      yield* store.tools.save(
        { ...made, view: "<p>second</p>", examples: [{ name: "month", block: "```funnel\nA: 1\n```" }] },
        call(),
      )
      const { plugins } = yield* rpc.list()
      expect(plugins.map((plugin) => [plugin.origin, plugin.examples])).toEqual([["user", ["month"]]])
      expect((yield* rpc.view({ id: "funnel" })).html).toBe("<p>second</p>")
      expect(
        yield* Effect.promise(() => fs.readdir(path.join(user, BuffChatPlugin.DIR, "funnel", "examples"))),
      ).toEqual(["month.md"])
    }),
  )

  it.live("a save is refused with the reason: bad files, a built-in's id, a block another plugin draws", () =>
    Effect.gen(function* () {
      const { store, user } = yield* setup([
        {
          id: "charts",
          files: files({ "plugin.json": JSON.stringify({ name: "Charts", description: "d", blocks: ["chart"] }) }),
        },
      ])
      yield* put(user, "sales-map", files())
      const refusal = (over: Record<string, unknown>) =>
        store.tools.save({ ...made, ...over } as typeof made, call()).pipe(
          Effect.flip,
          Effect.map((error) => error.message),
        )
      expect(yield* refusal({ view: "" })).toContain("view is empty")
      expect(yield* refusal({ id: "charts" })).toContain("built-in")
      expect(yield* refusal({ blocks: ["chart"], examples: [{ name: "a", block: "```chart\n1\n```" }] })).toContain(
        "«charts»",
      )
      expect(
        yield* refusal({ blocks: ["sales-map"], examples: [{ name: "a", block: "```sales-map\n1\n```" }] }),
      ).toContain("«sales-map»")
    }),
  )

  it.live("a view that names web addresses is saved with a warning: they will never load", () =>
    Effect.gen(function* () {
      const { store } = yield* setup()
      const text = yield* store.tools.save(
        { ...made, view: '<script src="https://cdn.example.com/x.js"></script>' },
        call(),
      )
      expect(text).toContain("Warning")
      expect(text).toContain("https://cdn.example.com/x.js")
    }),
  )

  it.live("the test hands the examples to the app through the call's metadata and reports what the app drew", () =>
    Effect.gen(function* () {
      const { rpc, store } = yield* setup()
      yield* store.tools.save(made, call())
      const progress: Array<Record<string, unknown>> = []
      const running = yield* Effect.forkChild(store.tools.test({ id: "funnel" }, call(progress)))
      yield* Effect.sleep("30 millis")
      const task = BuffChatPlugin.testOf(progress[0])
      expect(task).toMatchObject({
        id: "funnel",
        name: "Funnel",
        examples: [{ name: "week", block: "funnel", text: "Visits: 100\nOrders: 7" }],
      })
      yield* rpc.report({ session: "ses_1", call: "call_1", example: "week", ok: true, height: 180 })
      const text = yield* Fiber.join(running)
      expect(text).toContain("week: drawn, 180 px high")
      expect(text).toContain("All examples drew")
    }),
  )

  it.live("an error of the view comes back to the model; silence is not a pass", () =>
    Effect.gen(function* () {
      const { rpc, store } = yield* setup()
      yield* store.tools.save(made, call())
      const running = yield* Effect.forkChild(store.tools.test({ id: "funnel" }, call()))
      yield* Effect.sleep("30 millis")
      yield* rpc.report({ session: "ses_1", call: "call_1", example: "week", ok: false, error: "x is not defined" })
      expect(yield* Fiber.join(running)).toContain("week: FAILED — x is not defined")
      const silent = yield* store.tools.test({ id: "funnel" }, call())
      expect(silent).toContain("week: no answer")
      expect(silent).not.toContain("All examples drew")
    }),
  )

  it.live("the model removes only the person's own plugins", () =>
    Effect.gen(function* () {
      const { rpc, store } = yield* setup([{ id: "charts", files: files() }])
      yield* store.tools.save(made, call())
      expect(yield* store.tools.remove({ id: "funnel" }, call())).toContain("Removed")
      expect((yield* rpc.list()).plugins.map((plugin) => plugin.id)).toEqual(["charts"])
      const refusal = yield* store.tools.remove({ id: "charts" }, call()).pipe(Effect.flip)
      expect(refusal.message).toContain("built in")
    }),
  )

  it.live("the list tells the model what exists, what is off and what is broken", () =>
    Effect.gen(function* () {
      const { rpc, store, user } = yield* setup()
      yield* put(user, "sales-map", files())
      yield* put(user, "no-view", files({ "view.html": undefined }))
      yield* rpc.enable({ id: "sales-map", enabled: false })
      const text = yield* store.tools.list()
      expect(text).toContain("sales-map — «Sales map», blocks: sales-map; all projects; switched off by the user")
      expect(text).toContain("no-view")
      expect(text).toContain("BROKEN")
    }),
  )
})
