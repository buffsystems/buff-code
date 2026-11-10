import { describe, expect, test } from "bun:test"
import { BuffAttachment } from "../src/buff-attachment.js"

describe("BuffAttachment.modalityOf", () => {
  test("names the input kind a model has to support for a file", () => {
    expect(BuffAttachment.modalityOf("image/png")).toBe("image")
    expect(BuffAttachment.modalityOf("IMAGE/JPEG")).toBe("image")
    expect(BuffAttachment.modalityOf("application/pdf")).toBe("pdf")
    expect(BuffAttachment.modalityOf("audio/mpeg")).toBe("audio")
    expect(BuffAttachment.modalityOf("video/mp4")).toBe("video")
    expect(BuffAttachment.modalityOf("text/plain")).toBeUndefined()
  })
})

describe("BuffAttachment.omittedMedia", () => {
  test("collects the formats the person chose not to send, from their messages only, the later choice winning", () => {
    const omitted = BuffAttachment.omittedMedia([
      { type: "user", metadata: { source: "phone" } },
      { type: "user", metadata: BuffAttachment.omitMetadata(["image"], "ignore") },
      { type: "assistant", metadata: { omitMedia: ["video"] } },
      { type: "user", metadata: { omitMedia: ["pdf", "image", "spreadsheet", 3], omitAs: "code" } },
    ])
    expect([...omitted].sort()).toEqual([
      ["image", "code"],
      ["pdf", "code"],
    ])
  })

  test("a list without a mode means analysing the files with code", () => {
    expect(BuffAttachment.omittedMedia([{ type: "user", metadata: { omitMedia: ["image"] } }]).get("image")).toBe("code")
  })

  test("starts over when the person switches the model: the new one may read the formats", () => {
    const glm = { id: "glm-5.3-b300", providerID: "litellm" }
    const kimi = { id: "kimi-k2.8", providerID: "litellm" }
    const omitted = BuffAttachment.omittedMedia([
      { type: "user", metadata: BuffAttachment.omitMetadata(["image", "pdf"], "ignore") },
      { type: "model-switched", model: kimi, previous: glm },
      { type: "user", metadata: BuffAttachment.omitMetadata(["video"], "code") },
    ])
    expect([...omitted]).toEqual([["video", "code"]])
  })

  test("keeps the choice when the model stays the same", () => {
    const glm = { id: "glm-5.3-b300", providerID: "litellm" }
    const thinking = { ...glm, variant: "high" }
    const omitted = BuffAttachment.omittedMedia([
      { type: "user", metadata: BuffAttachment.omitMetadata(["image"], "ignore") },
      { type: "model-switched", model: thinking, previous: glm },
    ])
    expect(omitted.get("image")).toBe("ignore")
  })

  test("is empty without such messages", () => {
    expect(BuffAttachment.omittedMedia([{ type: "user" }]).size).toBe(0)
  })
})

describe("BuffAttachment.modalities", () => {
  test("lists each format of the files once, in order", () => {
    expect(
      BuffAttachment.modalities([
        { mime: "image/png" },
        { mime: "application/pdf" },
        { mime: "image/jpeg" },
        { mime: "text/plain" },
      ]),
    ).toEqual(["image", "pdf"])
  })
})
