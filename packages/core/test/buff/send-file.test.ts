// Файл от агента человеку (#708): только из папки сессии, существующий, не больше предела; в ленту —
// запись о файле, модели — короткое подтверждение без содержимого.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { BuffSendFilePlugin } from "../../src/buff/send-file"
import { testEffect } from "../lib/effect"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "../lib/tool"

const folder = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "send-file-"))
  await mkdir(path.join(dir, "docs"))
  await writeFile(path.join(dir, "docs", "Программа.docx"), Buffer.alloc(1500, 1))
  return dir
}

describe("send_file (#708)", () => {
  test("a file of the session's folder, by a relative or an absolute path", async () => {
    const dir = await folder()
    const sent = {
      file: "docs/Программа.docx",
      name: "Программа.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: 1500,
      note: "Черновик",
    }
    expect(BuffSendFilePlugin.handOver(dir, "docs/Программа.docx", "Черновик")).toEqual(sent)
    expect(BuffSendFilePlugin.handOver(dir, path.join(dir, "docs/Программа.docx"), " ")).toEqual({ ...sent, note: undefined })
  })

  test("nothing outside the folder, no folders, nothing missing, nothing too big", async () => {
    const dir = await folder()
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"))
    await writeFile(path.join(outside, "secret.txt"), "x")
    await symlink(path.join(outside, "secret.txt"), path.join(dir, "link.txt"))
    for (const wanted of ["../x", path.join(outside, "secret.txt"), "link.txt", "docs", "nope.pdf"])
      expect(BuffSendFilePlugin.handOver(dir, wanted, "")).toHaveProperty("error")
    await writeFile(path.join(dir, "big.bin"), Buffer.alloc(20 * 1024 * 1024 + 1))
    expect(BuffSendFilePlugin.handOver(dir, "big.bin", "")).toHaveProperty("error")
  })

  test("the model hears that the file reached the person, not the file", () => {
    const text = BuffSendFilePlugin.reply({ file: "docs/a.pdf", name: "a.pdf", mime: "application/pdf", bytes: 2048 })
    expect(text).toContain("docs/a.pdf")
    expect(text.length).toBeLessThan(300)
  })
})

// Вызов целиком: инструмент зарегистрирован, запись о файле уходит в metadata вызова — по ней
// окно, консоль и телефон рисуют карточку.
const workdir = mkdtempSync(path.join(os.tmpdir(), "send-file-tool-"))
writeFileSync(path.join(workdir, "отчёт.pdf"), "%PDF-1.7")
const sendNode = makeLocationNode({
  name: "test/buff-send-file-plugin",
  layer: Layer.effectDiscard(
    registerToolPlugin(BuffSendFilePlugin.Plugin, {
      location: new Location.Info({
        directory: AbsolutePath.make(workdir),
        project: { id: Project.ID.global, directory: AbsolutePath.make(workdir), canonical: AbsolutePath.make(workdir) },
      }),
    }),
  ),
  deps: [Tool.node],
})
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Tool.node, sendNode]), []))

describe("send_file as a tool", () => {
  it.effect("hands the file over in the call's metadata, the model gets a line", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect((yield* toolDefinitions(registry)).map((d) => d.name)).toContain("send_file")
      const result = yield* executeTool(registry, {
        sessionID: Session.ID.make("ses_send_file_test"),
        ...toolIdentity,
        call: { type: "tool-call", id: "call-send", name: "send_file", input: { path: "отчёт.pdf", note: "Итог" } },
      })
      expect(result.status).toBe("completed")
      expect(result.metadata).toEqual({
        sent: { file: "отчёт.pdf", name: "отчёт.pdf", mime: "application/pdf", bytes: 8, note: "Итог" },
      })
      expect(JSON.stringify(result.content)).not.toContain("%PDF")
    }),
  )
})
