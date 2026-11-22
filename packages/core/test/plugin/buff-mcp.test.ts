// Управление MCP-серверами из интерфейса (#444): ядро хранит их в файле конфигурации
// пользователя или проекта и отдаёт экранам вместе с областью и статусом.
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { Document, Info } from "@opencode/schema/config"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { BuffMcpPlugin } from "@opencode/core/buff/mcp"
import { BuffSkillPlugin } from "@opencode/core/buff/skill"
import { BuffConnectionScript } from "@opencode/core/buff/connection-script"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp } from "./fixture"

const it = testEffect(PluginTestLayerWithMcp)
const local = { type: "local" as const, command: ["definitely-not-a-program-444"] }

const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf8").then(JSON.parse))

const setupWith = (options: { project: boolean }) => Effect.gen(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service, "buff.mcp")
  // В тестовом слое файлы конфигурации никто не перечитывает — ждать этого незачем.
  const project = (yield* Location.Service).directory
  const user = yield* Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "buff-mcp-user-"))),
    (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
  )
  // Конфигурация в памяти: документы в ней задаёт сам тест — как это сделал бы наблюдатель за файлами.
  const config = Context.get(yield* Layer.build(Config.testLayer()), Config.Test)
  // Личная папка проекта (#951) — в конфигурации пользователя; вне проекта её нет.
  const personal = path.join(user, "projects", "prj_one")
  yield* BuffMcpPlugin.register(host, {
    settle: "0 millis",
    userDirectory: user,
    ...(options.project ? { localDirectory: personal } : {}),
  }).pipe(
    Effect.provideService(Config.Service, config),
  )
  const loaded = (...files: string[]) =>
    Effect.forEach(files, (file) =>
      read(file).pipe(
        Effect.map((json) => new Document({ type: "document", path: AbsolutePath.make(file), info: new Info(json) })),
      ),
    ).pipe(Effect.flatMap(config.setEntries))
  // Навыки — рядом: инструкции к подключению переезжают вместе с ним (#951).
  yield* BuffSkillPlugin.register(yield* PluginHost.make(yield* Plugin.Service, "buff.skill"), {
    settle: "0 millis",
    userDirectory: user,
    ...(options.project ? { localDirectory: personal } : {}),
  }).pipe(Effect.provideService(Config.Service, config))
  const client = (yield* Rpc.Service).client
  return { rpc: client(BuffMcp.Rpc), skills: client(BuffSkill.Rpc), project, user, personal, loaded }
})
const setup = setupWith({ project: true })

describe("BuffMcp (#444)", () => {
  it.live("a server saved for the user lands in the user's configuration file", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup
      yield* rpc.save({ scope: "user", name: "files", config: local })
      expect(yield* read(path.join(user, "buffcode.jsonc"))).toEqual({ mcp: { servers: { files: local } } })
    }),
  )

  it.live("a server saved for the project lands in the project's file, and the list says where it lives", () =>
    Effect.gen(function* () {
      const { rpc, project, loaded } = yield* setup
      yield* rpc.save({ scope: "project", name: "files", config: local })
      const file = path.join(project, "buffcode.json")
      expect(yield* read(file)).toEqual({ mcp: { servers: { files: local } } })
      yield* loaded(file)
      expect(yield* rpc.list()).toEqual([
        { name: "files", scope: "project", file, config: local, status: { status: "pending" } },
      ])
    }),
  )

  it.live("a server the configuration does not hold is built in: shown, with its status, not editable", () =>
    Effect.gen(function* () {
      const { rpc } = yield* setup
      const mcp = yield* Mcp.Service
      yield* mcp.transform((editor) => editor.set("buff", { type: "remote", url: "http://127.0.0.1:1", oauth: false }))
      yield* mcp.reload()
      const list = yield* rpc.list()
      expect(list.map((entry) => [entry.name, entry.scope, entry.config])).toEqual([["buff", "builtin", undefined]])
    }),
  )

  it.live("a wrong name or an empty command is refused with the reason", () =>
    Effect.gen(function* () {
      const { rpc } = yield* setup
      const name = yield* rpc.save({ scope: "user", name: "buff", config: local }).pipe(Effect.flip)
      expect(name).toMatchObject({
        type: "invalid",
        message: "Имя «buff» занято встроенным сервером Buff — выберите другое.",
      })
      const command = yield* rpc
        .save({ scope: "user", name: "files", config: { type: "local", command: [] } })
        .pipe(Effect.flip)
      expect(command).toMatchObject({ type: "invalid", message: "Укажите команду запуска сервера." })
    }),
  )

  it.live("renaming or moving a server leaves no copy behind", () =>
    Effect.gen(function* () {
      const { rpc, user, project, loaded } = yield* setup
      yield* rpc.save({ scope: "user", name: "files", config: local })
      const userFile = path.join(user, "buffcode.jsonc")
      yield* loaded(userFile)
      yield* rpc.save({ scope: "project", name: "docs", config: local, previous: { scope: "user", name: "files" } })
      expect(yield* read(userFile)).toEqual({ mcp: { servers: {} } })
      expect(yield* read(path.join(project, "buffcode.json"))).toEqual({ mcp: { servers: { docs: local } } })
    }),
  )

  // #951: «только у меня, только в этом проекте» — в личной папке проекта, не в репозитории.
  it.live("a server saved for this project only lands in the project's personal file", () =>
    Effect.gen(function* () {
      const { rpc, project, personal, loaded } = yield* setup
      yield* rpc.save({ scope: "local", name: "files", config: local })
      const file = path.join(personal, "buffcode.jsonc")
      expect(yield* read(file)).toEqual({ mcp: { servers: { files: local } } })
      expect(yield* Effect.promise(() => fs.readdir(project))).toEqual([])
      yield* loaded(file)
      expect(yield* rpc.list()).toEqual([
        { name: "files", scope: "local", file, config: local, status: { status: "pending" } },
      ])
    }),
  )

  it.live("changing who sees a server moves it between the personal file and the shared one", () =>
    Effect.gen(function* () {
      const { rpc, user, personal, loaded } = yield* setup
      const personalFile = path.join(personal, "buffcode.jsonc")
      const userFile = path.join(user, "buffcode.jsonc")
      yield* rpc.save({ scope: "local", name: "files", config: local })
      yield* loaded(personalFile)
      yield* rpc.save({ scope: "user", name: "files", config: local, previous: { scope: "local", name: "files" } })
      expect(yield* read(personalFile)).toEqual({ mcp: { servers: {} } })
      expect(yield* read(userFile)).toEqual({ mcp: { servers: { files: local } } })
      yield* loaded(personalFile, userFile)
      yield* rpc.save({ scope: "local", name: "files", config: local, previous: { scope: "user", name: "files" } })
      expect(yield* read(userFile)).toEqual({ mcp: { servers: {} } })
      expect(yield* read(personalFile)).toEqual({ mcp: { servers: { files: local } } })
    }),
  )

  it.live("a script connection changes who sees it together with its script and its instructions", () =>
    Effect.gen(function* () {
      const { rpc, skills, user, personal, loaded } = yield* setup
      const from = BuffConnectionScript.paths(personal, "mail")
      const to = BuffConnectionScript.paths(user, "mail")
      const code = "export const tools = []\n"
      yield* Effect.promise(async () => {
        await fs.mkdir(from.directory, { recursive: true })
        await fs.writeFile(from.script, code)
      })
      const environment = { TOKEN: "{secret:sec_1}" }
      const before = BuffConnectionScript.config(from, environment)
      yield* rpc.save({ scope: "local", name: "mail", config: before })
      const instructions = { name: "Connection «mail»", description: "How to use it", body: "Read only.\n" }
      yield* skills.save({ scope: "local", id: "connection-mail", ...instructions })
      yield* loaded(path.join(personal, "buffcode.jsonc"))

      yield* rpc.save({ scope: "user", name: "mail", config: before, previous: { scope: "local", name: "mail" } })

      expect(yield* read(path.join(user, "buffcode.jsonc"))).toEqual({
        mcp: { servers: { mail: BuffConnectionScript.config(to, environment) } },
      })
      expect(yield* Effect.promise(() => fs.readFile(to.script, "utf8"))).toBe(code)
      expect(yield* Effect.promise(() => fs.readFile(to.runner, "utf8"))).toBe(BuffConnectionScript.stamped)
      expect(yield* Effect.promise(() => fs.readdir(from.directory))).toEqual([])
      expect((yield* skills.list()).skills.map((skill) => [skill.id, skill.scope])).toEqual([
        ["connection-mail", "user"],
      ])
      expect(yield* skills.read({ scope: "user", id: "connection-mail" })).toEqual(instructions)
    }),
  )

  it.live("outside a project there is nothing to keep «for this project only»", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setupWith({ project: false })
      const refusal = yield* rpc.save({ scope: "local", name: "files", config: local }).pipe(Effect.flip)
      expect(refusal).toMatchObject({ type: "invalid", message: "Здесь нет проекта: сохраните для всех проектов." })
      expect(yield* Effect.promise(() => fs.readdir(user))).toEqual([])
    }),
  )

  it.live("a server is removed from its file; switching it off is written down", () =>
    Effect.gen(function* () {
      const { rpc, user, loaded } = yield* setup
      const file = path.join(user, "buffcode.jsonc")
      yield* rpc.save({ scope: "user", name: "files", config: local })
      yield* loaded(file)
      yield* rpc.enable({ scope: "user", name: "files", enabled: false })
      expect(yield* read(file)).toEqual({ mcp: { servers: { files: { ...local, disabled: true } } } })
      yield* rpc.remove({ scope: "user", name: "files" })
      expect(yield* read(file)).toEqual({ mcp: { servers: {} } })
    }),
  )

  // #510: у проекта, где уже есть opencode.json, настройки не разъезжаются по двум файлам.
  it.live("a project that already has opencode.json keeps getting its servers there", () =>
    Effect.gen(function* () {
      const { rpc, project } = yield* setup
      const legacy = path.join(project, "opencode.json")
      yield* Effect.promise(() => fs.writeFile(legacy, "{}\n"))
      yield* rpc.save({ scope: "project", name: "files", config: local })
      expect(yield* read(legacy)).toEqual({ mcp: { servers: { files: local } } })
      expect(yield* Effect.promise(() => fs.stat(path.join(project, "buffcode.json")).then(() => true, () => false))).toBe(false)
    }),
  )

  it.live("a configuration file that cannot be read is not written over", () =>
    Effect.gen(function* () {
      const { rpc, project } = yield* setup
      const file = path.join(project, "opencode.json")
      yield* Effect.promise(() => fs.writeFile(file, "{ nope"))
      const refused = yield* rpc.save({ scope: "project", name: "files", config: local }).pipe(Effect.flip)
      expect(refused).toMatchObject({ type: "unwritable" })
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("{ nope")
    }),
  )
})
