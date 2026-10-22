// Просмотр файлов (#451): байты с диска → то, что можно показать.
import { describe, expect, test } from "bun:test"
import { fileContent, previewKind, mediaKind } from "./file-content"

const bytes = (text: string) => new TextEncoder().encode(text)

describe("what a file is shown as", () => {
  test("text stays text", () => {
    expect(fileContent("a.ts", bytes("const a = 1\n"))).toEqual({ type: "text", content: "const a = 1\n" })
  })

  test("a picture and a sound come as base64 with their type — the viewer draws them", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(fileContent("logo.PNG", png)).toEqual({
      type: "binary",
      encoding: "base64",
      mimeType: "image/png",
      content: "iVBORw0KGgo=",
    })
    expect(fileContent("beep.mp3", new Uint8Array([1, 2, 3]))).toMatchObject({ type: "binary", mimeType: "audio/mpeg" })
  })

  test("SVG is text marked as a picture: shown both as picture and as source", () => {
    expect(fileContent("icon.svg", bytes("<svg/>"))).toEqual({
      type: "text",
      content: "<svg/>",
      mimeType: "image/svg+xml",
    })
  })

  test("PDF and video are not kept in memory — the viewer reads them when shown", () => {
    expect(fileContent("doc.pdf", new Uint8Array([0x25, 0x50]))).toEqual({
      type: "binary",
      content: "",
      mimeType: "application/pdf",
    })
    expect(fileContent("clip.mp4", new Uint8Array([0]))).toEqual({ type: "binary", content: "", mimeType: "video/mp4" })
  })

  test("anything else that is not text says so instead of showing garbage", () => {
    expect(fileContent("data.bin", new Uint8Array([0x00, 0xff, 0x10, 0x00]))).toEqual({
      type: "binary",
      content: "",
      mimeType: "application/octet-stream",
    })
    expect(fileContent("broken.txt", new Uint8Array([0xc3, 0x28]))).toMatchObject({ type: "binary" })
  })
})

describe("which files get their own preview", () => {
  test("by extension", () => {
    expect(previewKind("README.md")).toBe("markdown")
    expect(previewKind("docs/guide.markdown")).toBe("markdown")
    expect(previewKind("flow.mmd")).toBe("mermaid")
    expect(previewKind("flow.mermaid")).toBe("mermaid")
    expect(previewKind("doc.pdf")).toBe("pdf")
    expect(previewKind("clip.webm")).toBe("video")
    expect(previewKind("a.ts")).toBeUndefined()
    expect(previewKind(undefined)).toBeUndefined()
  })
})

// #459: вложение показывается тем же просмотром — по типу файла.
describe("how an attachment is shown", () => {
  test("by its type", () => {
    expect(mediaKind("image/png")).toBe("image")
    expect(mediaKind("video/mp4")).toBe("video")
    expect(mediaKind("audio/mpeg")).toBe("audio")
    expect(mediaKind("application/pdf")).toBe("pdf")
    expect(mediaKind("text/markdown")).toBe("text")
    expect(mediaKind("application/json")).toBe("text")
    expect(mediaKind("application/zip")).toBeUndefined()
  })
})
