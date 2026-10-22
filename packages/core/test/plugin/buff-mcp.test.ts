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
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp } from "./fixture"

const it = testEffect(PluginTestLayerWithMcp)
const local = { type: "local" as const, command: ["definitely-not-a-program-444"] }

const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf8").then(JSON.parse))

const setup = Effect.gen(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service, "buff.mcp")
  // В тестовом слое файлы конфигурации никто не перечитывает — ждать этого незачем.
  const project = (yield* Location.Service).directory
  const user = yield* Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "buff-mcp-user-"))),
    (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
  )
  // Конфигурация в памяти: документы в ней задаёт сам тест — как это сделал бы наблюдатель за файлами.
  const config = Context.get(yield* Layer.build(Config.testLayer()), Config.Test)
  yield* BuffMcpPlugin.register(host, { settle: "0 millis", userDirectory: user }).pipe(
    Effect.provideService(Config.Service, config),
  )
  const loaded = (...files: string[]) =>
    Effect.forEach(files, (file) =>
      read(file).pipe(
        Effect.map((json) => new Document({ type: "document", path: AbsolutePath.make(file), info: new Info(json) })),
      ),
    ).pipe(Effect.flatMap(config.setEntries))
  return { rpc: (yield* Rpc.Service).client(BuffMcp.Rpc), project, user, loaded }
})

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
