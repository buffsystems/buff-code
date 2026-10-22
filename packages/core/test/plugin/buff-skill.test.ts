// Управление навыками из интерфейса (#445): ядро пишет свои навыки файлами SKILL.md, выключает
// любой навык, не трогая его файл, и отдаёт экранам список с областью и признаком «включён».
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { Document, Info } from "@opencode/schema/config"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { BuffSkillPlugin } from "@opencode/core/buff/skill"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const notes = { name: "Заметки к выпуску", description: "Когда просят заметки к выпуску", body: "Пиши коротко.\n" }
const exists = (file: string) =>
  Effect.promise(() =>
    fs.access(file).then(
      () => true,
      () => false,
    ),
  )
const text = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const setup = Effect.gen(function* () {
  const project = (yield* Location.Service).directory
  const user = yield* Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "buff-skill-user-"))),
    (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
  )
  const config = Context.get(yield* Layer.build(Config.testLayer()), Config.Test)
  const host = yield* PluginHost.make(yield* Plugin.Service, "buff.skill")
  yield* BuffSkillPlugin.register(host, { settle: "0 millis", userDirectory: user }).pipe(
    Effect.provideService(Config.Service, config),
  )
  return { rpc: (yield* Rpc.Service).client(BuffSkill.Rpc), project, user, config }
})

describe("BuffSkill (#445)", () => {
  it.live("a skill created for the user is a SKILL.md in the user's skills, and the list shows it", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup
      yield* rpc.save({ scope: "user", id: "release-notes", ...notes })
      const file = path.join(user, "skills", "release-notes", "SKILL.md")
      expect(yield* text(file)).toBe(BuffSkill.fileText(notes))
      expect((yield* rpc.list()).skills).toEqual([
        {
          id: "release-notes",
          name: notes.name,
          description: notes.description,
          scope: "user",
          path: file,
          enabled: true,
        },
      ])
    }),
  )

  it.live("a skill created for the project lives in the project's .buffcode", () =>
    Effect.gen(function* () {
      const { rpc, project } = yield* setup
      yield* rpc.save({ scope: "project", id: "release-notes", ...notes })
      const file = path.join(project, ".buffcode", "skills", "release-notes", "SKILL.md")
      expect(yield* exists(file)).toBe(true)
      expect((yield* rpc.list()).skills.map((skill) => [skill.id, skill.scope])).toEqual([["release-notes", "project"]])
    }),
  )

  // #510: проект, где уже есть .opencode, не получает второго каталога настроек.
  it.live("a project that already has .opencode keeps its skills there", () =>
    Effect.gen(function* () {
      const directory = (yield* Location.Service).directory
      yield* Effect.promise(() => fs.mkdir(path.join(directory, ".opencode"), { recursive: true }))
      const { rpc, project } = yield* setup
      yield* rpc.save({ scope: "project", id: "release-notes", ...notes })
      expect(yield* exists(path.join(project, ".opencode", "skills", "release-notes", "SKILL.md"))).toBe(true)
      expect(yield* exists(path.join(project, ".buffcode"))).toBe(false)
    }),
  )

  it.live("a skill opens for editing as it was written, and editing keeps the rest of its header", () =>
    Effect.gen(function* () {
      const { rpc, user } = yield* setup
      const file = path.join(user, "skills", "by-hand", "SKILL.md")
      yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
      yield* Effect.promise(() =>
        fs.writeFile(file, "---\nname: By hand\ndescription: Old\nlicense: MIT\n---\nOld text\n"),
      )
      expect(yield* rpc.read({ scope: "user", id: "by-hand" })).toEqual({
        name: "By hand",
        description: "Old",
        body: "Old text\n",
      })
      yield* rpc.save({ scope: "user", id: "by-hand", name: "By hand", description: "New", body: "New text\n" })
      expect(yield* text(file)).toBe('---\nname: "By hand"\ndescription: "New"\nlicense: MIT\n---\n\nNew text\n')
    }),
  )

  it.live("a wrong identifier or a skill without a description is refused with the reason", () =>
    Effect.gen(function* () {
      const { rpc } = yield* setup
      expect(yield* rpc.save({ scope: "user", id: "Release Notes", ...notes }).pipe(Effect.flip)).toMatchObject({
        type: "invalid",
        message: "Идентификатор — строчные латинские буквы, цифры и дефис, например release-notes.",
      })
      expect(
        yield* rpc.save({ scope: "user", id: "notes", ...notes, description: "" }).pipe(Effect.flip),
      ).toMatchObject({
        type: "invalid",
      })
    }),
  )

  it.live("renaming or moving a skill leaves no copy behind; removing takes its directory away", () =>
    Effect.gen(function* () {
      const { rpc, user, project } = yield* setup
      yield* rpc.save({ scope: "user", id: "notes", ...notes })
      yield* rpc.save({ scope: "project", id: "release-notes", ...notes, previous: { scope: "user", id: "notes" } })
      expect(yield* exists(path.join(user, "skills", "notes"))).toBe(false)
      const moved = path.join(project, ".buffcode", "skills", "release-notes")
      expect(yield* exists(path.join(moved, "SKILL.md"))).toBe(true)
      yield* rpc.remove({ scope: "project", id: "release-notes" })
      expect(yield* exists(moved)).toBe(false)
      expect((yield* rpc.list()).skills).toEqual([])
    }),
  )

  it.live("a skill switched off disappears for the model and stays in the list as off; its file is untouched", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      // Навык, который дал кто-то ещё (плагин, чужой каталог): выключается так же.
      yield* skills.transform((editor) =>
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("report"),
            name: Skill.Name.make("Report"),
            description: "Report a bug",
            path: AbsolutePath.make("/builtin/report.md"),
            content: "…",
          }),
        ),
      )
      const { rpc } = yield* setup
      const ids = () => skills.list().pipe(Effect.map((list) => list.map((skill) => String(skill.id))))
      expect(yield* ids()).toEqual(["report"])
      yield* rpc.enable({ id: "report", enabled: false })
      expect(yield* ids()).toEqual([])
      expect((yield* rpc.list()).skills).toEqual([
        {
          id: "report",
          name: "Report",
          description: "Report a bug",
          scope: "builtin",
          path: undefined,
          enabled: false,
        },
      ])
      yield* rpc.enable({ id: "report", enabled: true })
      expect(yield* ids()).toEqual(["report"])
    }),
  )

  it.live("a directory of skills is attached through the user's configuration and detached again", () =>
    Effect.gen(function* () {
      const { rpc, user, config } = yield* setup
      const file = path.join(user, "buffcode.jsonc")
      yield* rpc.attach({ scope: "user", source: "~/team-skills", attached: true })
      expect(JSON.parse(yield* text(file))).toEqual({ skills: ["~/team-skills"] })
      yield* config.setEntries([
        new Document({
          type: "document",
          path: AbsolutePath.make(file),
          info: new Info({ skills: ["~/team-skills"] }),
        }),
      ])
      expect((yield* rpc.list()).sources).toEqual([{ scope: "user", source: "~/team-skills" }])
      yield* rpc.attach({ scope: "user", source: "~/team-skills", attached: false })
      expect(JSON.parse(yield* text(file))).toEqual({ skills: [] })
    }),
  )
})
