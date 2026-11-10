import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Message, ToolResultPart } from "@opencode/ai"
import { unsupportedParts } from "@opencode/core/session/model-request"
import { SessionMediaFiles } from "@opencode/core/session/media-files"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })
const png = { type: "media" as const, mediaType: "image/png", data: "aGVsbG8=", filename: "logo.png" }

describe("unsupportedParts with omitted formats and saved files (#757)", () => {
  test("replaces a format the person chose not to send, even when the model supports it", () => {
    const messages = unsupportedParts([Message.user([Message.text("Look"), png])], capabilities(["text", "image"]), {
      omitted: new Map([["image", "code"]]),
      saved: new Map([[SessionMediaFiles.mediaKey(png.data), "/tmp/a/logo.png"]]),
    })
    expect(messages[0]?.content).toEqual([
      Message.text("Look"),
      Message.text(
        '"logo.png" is not attached as an image: in this session the user asked to analyse image files with code instead. The file is saved at /tmp/a/logo.png: analyse it with code or command-line tools if the task needs it.',
      ),
    ])
  })

  test("a format the person chose to go on without is named, not offered to read", () => {
    const messages = unsupportedParts([Message.user(png)], capabilities(["text", "image"]), {
      omitted: new Map([["image", "ignore"]]),
      saved: new Map([[SessionMediaFiles.mediaKey(png.data), "/tmp/a/logo.png"]]),
    })
    expect(messages[0]?.content).toEqual([
      Message.text(
        '"logo.png" is not attached as an image: in this session the user chose to go on without image files. Do not try to read it.',
      ),
    ])
  })

  test("tells where an unreadable file is saved", () => {
    const messages = unsupportedParts([Message.user(png)], capabilities(["text"]), {
      saved: new Map([[SessionMediaFiles.mediaKey(png.data), "/tmp/a/logo.png"]]),
    })
    expect(messages[0]?.content).toEqual([
      Message.text(
        'ERROR: Cannot read "logo.png" (this model does not support image input). The file is saved at /tmp/a/logo.png: analyse it with code or command-line tools if the task needs it. Inform the user.',
      ),
    ])
  })
})

describe("SessionMediaFiles.replaced", () => {
  test("lists the media that will reach the model as text", () => {
    const pdf = { type: "media" as const, mediaType: "application/pdf", data: "JVBERg==", filename: "brand.pdf" }
    const messages = [
      Message.user([png, pdf]),
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [{ type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "shot.png" }],
          },
        }),
      ),
    ]
    expect(SessionMediaFiles.replaced(messages, capabilities(["text", "image"]), new Map())).toEqual([
      { key: SessionMediaFiles.mediaKey(pdf.data), data: pdf.data, mime: "application/pdf", name: "brand.pdf" },
    ])
    expect(
      SessionMediaFiles.replaced(messages, capabilities(["text", "image"]), new Map([["image", "code"]])).map(
        (m) => m.name,
      ),
    ).toEqual(["logo.png", "brand.pdf", "shot.png"])
    // Files the person went on without are not saved: the model is not offered to read them.
    expect(
      SessionMediaFiles.replaced(messages, capabilities(["text", "image"]), new Map([["image", "ignore"]])).map(
        (m) => m.name,
      ),
    ).toEqual(["brand.pdf"])
  })
})

describe("SessionMediaFiles.save", () => {
  test("writes each file once by its content and keeps paths of files already on disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "media-files-"))
    const onDisk = path.join(dir, "already.png")
    const uri = pathToFileURL(onDisk).href
    const saved = await SessionMediaFiles.save(
      [
        { key: "k1", data: "aGVsbG8=", mime: "image/png", name: "../logo.png" },
        { key: "k2", data: "data:application/pdf;base64,JVBERg==", mime: "application/pdf" },
        { key: uri, data: uri, mime: "image/png", name: "already.png" },
      ],
      dir,
    )
    const logo = saved.get("k1")!
    expect(path.dirname(logo)).toBe(dir)
    expect(path.basename(logo)).toMatch(/^[0-9a-f]{12}-logo\.png$/)
    expect(await fs.readFile(logo, "utf8")).toBe("hello")
    expect(path.basename(saved.get("k2")!)).toMatch(/^[0-9a-f]{12}-file\.pdf$/)
    expect(await fs.readFile(saved.get("k2")!, "latin1")).toBe("%PDF")
    expect(saved.get(uri)).toBe(onDisk)

    const again = await SessionMediaFiles.save([{ key: "k1", data: "aGVsbG8=", mime: "image/png", name: "logo.png" }], dir)
    expect(again.get("k1")).toBe(logo)
    await fs.rm(dir, { recursive: true })
  })
})

describe("SessionMediaFiles.withAttachments", () => {
  const request = [Message.user([Message.text("Look"), png])]

  test("names the files of a request the model rejected", () => {
    expect(
      SessionMediaFiles.withAttachments({ type: "provider.invalid-request", message: "bad image", status: 400 }, request),
    ).toEqual({
      type: "provider.invalid-request",
      message: "bad image",
      status: 400,
      attachments: [{ name: "logo.png", mime: "image/png" }],
    })
  })

  test("names a file attached by its path with the file name alone", () => {
    const byPath = [
      Message.user([{ ...png, filename: "/private/tmp/brand.png" }, { ...png, data: "aQ==", filename: "C:\\work\\shot.png" }]),
    ]
    expect(
      SessionMediaFiles.withAttachments({ type: "provider.invalid-request", message: "x" }, byPath).attachments,
    ).toEqual([
      { name: "brand.png", mime: "image/png" },
      { name: "shot.png", mime: "image/png" },
    ])
  })

  test("leaves failures that files cannot cause", () => {
    for (const type of ["provider.rate-limit", "provider.auth", "provider.quota", "provider.transport", "aborted"]) {
      const error = { type, message: "x" }
      expect(SessionMediaFiles.withAttachments(error, request)).toBe(error)
    }
  })

  test("leaves a request without files", () => {
    const error = { type: "provider.invalid-request", message: "x" }
    expect(SessionMediaFiles.withAttachments(error, [Message.user(Message.text("hi"))])).toBe(error)
  })
})
