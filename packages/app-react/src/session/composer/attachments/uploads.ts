// Uploads in flight (#584), one list per window: they outlive the composer that started them and
// feed every upload chip, as in the Solid composer's uploads.tsx.

import { createStore } from "../../../core/store"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"

export type Upload = {
  id: string
  filename: string
  mime: string
  size: number
  loaded: number
  cancel(): void
}

const items = createStore<Upload[]>([])

export const uploads = {
  store: items,
  /** Runs `work` while the upload is listed; resolves undefined when the person cancels it. */
  async track<Value>(
    input: Pick<Upload, "id" | "filename" | "mime" | "size">,
    work: (report: (loaded: number) => void, signal: AbortSignal) => Promise<Value>,
  ): Promise<Value | undefined> {
    const controller = new AbortController()
    items.set((list) => [...list, { ...input, loaded: 0, cancel: () => controller.abort() }])
    const report = (loaded: number) =>
      items.set((list) => list.map((item) => (item.id === input.id ? { ...item, loaded } : item)))
    try {
      return await work(report, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return undefined
      throw error
    } finally {
      items.set((list) => list.filter((item) => item.id !== input.id))
    }
  },
}

export function uploadPercent(upload: Upload) {
  return upload.size === 0 ? 100 : Math.floor((upload.loaded / upload.size) * 100)
}

/** Streams a file into the server, reporting progress (fetch cannot report upload progress). */
export function uploadFile(input: {
  url: URL
  file: File
  password?: string
  report: (loaded: number) => void
  signal: AbortSignal
}) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", input.url)
    xhr.responseType = "json"
    xhr.setRequestHeader("content-type", "application/octet-stream")
    if (input.password)
      xhr.setRequestHeader("authorization", `Basic ${btoa(`${BuffServerAuth.LEGACY_USERNAME}:${input.password}`)}`)
    xhr.upload.addEventListener("progress", (event) => input.report(event.loaded))
    xhr.addEventListener("load", () => {
      if (xhr.status !== 200) return reject(new Error(`Upload failed with status ${xhr.status}`))
      resolve((xhr.response as { data: { path: string } }).data.path)
    })
    xhr.addEventListener("error", () => reject(new Error("Upload failed")))
    xhr.addEventListener("abort", () => reject(new DOMException("Upload aborted", "AbortError")))
    input.signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(input.file)
  })
}
