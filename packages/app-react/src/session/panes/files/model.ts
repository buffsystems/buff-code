// One workspace's files (#584): the directory tree, the opened files' contents and the file
// search, as the Solid window's file model keeps them, in a plain-TS store. Filesystem events of the
// workspace reload what is open and relist what is shown.

import { fileContent } from "@opencode/app/react-reuse/file-content"
import { createPathHelpers } from "@opencode/app/react-reuse/file-path"
import { invalidateFromWatcher } from "@opencode/app/react-reuse/file-watcher"
import { isFileNotFoundError, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import { createStore } from "../../../core/store"

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export type FileContent = NonNullable<ReturnType<typeof fileContent>>

export type FileState = {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  notFound?: boolean
  error?: string
  content?: FileContent
}

export type DirState = { expanded: boolean; loaded?: boolean; loading?: boolean; error?: string; children?: string[] }

export type FilesState = {
  file: Record<string, FileState>
  node: Record<string, FileNode>
  dir: Record<string, DirState>
}

export type FilesInput = {
  api: () => OpenCodeClient
  directory: string
  /** A failed read or listing: the toast's title key and the server's message. */
  onError: (kind: "load" | "list", message: string) => void
  formatError: (error: unknown) => string
  /** Whether a file is open in some tab, so a change reloads it even before it was read. */
  isOpen?: (path: string) => boolean
}

const MAX_CONTENT_ENTRIES = 40

const emptyState = (): FilesState => ({ file: {}, node: {}, dir: { "": { expanded: true } } })

export function createFiles(input: FilesInput) {
  const path = createPathHelpers(() => input.directory)
  const store = createStore<FilesState>(emptyState())
  const reads = new Map<string, Promise<void>>()
  const lists = new Map<string, Promise<void>>()
  // Most recently read last: the oldest contents beyond the limit are dropped and read again later.
  const recent: string[] = []

  const editFile = (file: string, update: (state: FileState) => FileState) =>
    store.set((state) => {
      const current = state.file[file] ?? { path: file, name: getFilename(file) }
      return { ...state, file: { ...state.file, [file]: update(current) } }
    })
  const editDir = (dir: string, update: (state: DirState) => DirState) =>
    store.set((state) => ({ ...state, dir: { ...state.dir, [dir]: update(state.dir[dir] ?? { expanded: false }) } }))

  const remember = (file: string) => {
    const at = recent.indexOf(file)
    if (at !== -1) recent.splice(at, 1)
    recent.push(file)
    while (recent.length > MAX_CONTENT_ENTRIES) {
      const evicted = recent.shift()
      if (evicted) editFile(evicted, (state) => ({ ...state, content: undefined, loaded: false }))
    }
  }

  const load = (raw: string, options?: { force?: boolean }) => {
    const file = path.normalize(raw)
    if (!file) return Promise.resolve()
    if (!options?.force && store.get().file[file]?.loaded) return Promise.resolve()
    const pending = reads.get(file)
    if (pending) return pending
    editFile(file, (state) => ({ ...state, loading: true, error: undefined }))
    const promise = input
      .api()
      .file.read({ path: file, location: { directory: input.directory } })
      .then((data) => {
        // Buff (#451): images, audio, SVG, PDF, video and binaries are not text.
        const content = fileContent(file, data)
        editFile(file, (state) => ({ ...state, loaded: true, loading: false, notFound: false, content }))
        if (content) remember(file)
      })
      .catch((error: unknown) => {
        const notFound = isFileNotFoundError(error)
        editFile(file, (state) => ({
          ...state,
          loading: false,
          notFound,
          error: input.formatError(error),
          ...(notFound ? { loaded: false, content: undefined } : {}),
        }))
        input.onError("load", input.formatError(error))
      })
      .finally(() => reads.delete(file))
    reads.set(file, promise)
    return promise
  }

  const listDir = (raw: string, options?: { force?: boolean }) => {
    const dir = path.normalizeDir(raw)
    if (!options?.force && store.get().dir[dir]?.loaded) return Promise.resolve()
    const pending = lists.get(dir)
    if (pending) return pending
    editDir(dir, (state) => ({ ...state, loading: true, error: undefined }))
    const promise = input
      .api()
      .file.list({ path: dir, location: { directory: input.directory } })
      .then((result) => {
        const nodes: FileNode[] = result.data.map((entry) => ({
          ...entry,
          name: getFilename(entry.path),
          absolute: `${input.directory}/${entry.path}`,
          ignored: false,
        }))
        store.set((state) => applyListing(state, dir, nodes))
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : input.formatError(error)
        editDir(dir, (state) => ({ ...state, loading: false, error: message }))
        input.onError("list", message)
      })
      .finally(() => lists.delete(dir))
    lists.set(dir, promise)
    return promise
  }

  const search = (query: string, type: "file" | undefined, options?: { limit?: number; signal?: AbortSignal }) =>
    input
      .api()
      .file.find(
        { location: { directory: input.directory }, query, type, limit: options?.limit },
        { signal: options?.signal },
      )
      .then(
        (result) => result.data.map((entry) => path.normalize(entry.path)),
        (error: unknown) => {
          if (options?.signal?.aborted) throw error
          return [] as string[]
        },
      )

  const handle = (event: OpenCodeEvent) => {
    if (event.type !== "filesystem.changed") return
    if (event.location?.directory !== undefined && event.location.directory !== input.directory) return
    invalidateFromWatcher(event, {
      normalize: path.normalize,
      hasFile: (file) => Boolean(store.get().file[file]),
      isOpen: input.isOpen,
      loadFile: (file) => void load(file, { force: true }),
      node: (file) => store.get().node[file],
      isDirLoaded: (dir) => Boolean(store.get().dir[dir]?.loaded),
      refreshDir: (dir) => void listDir(dir, { force: true }),
    })
  }

  return {
    store,
    directory: input.directory,
    normalize: path.normalize,
    /** A directory key as the tree keeps it (Windows separators and a trailing one folded). */
    normalizeDir: path.normalizeDir,
    tab: path.tab,
    pathFromTab: path.pathFromTab,
    load,
    handle,
    get: (raw: string) => store.get().file[path.normalize(raw)],
    /** The raw bytes, for players that read a file when shown (PDF, video). */
    readBytes: (raw: string) =>
      input.api().file.read({ path: path.normalize(raw), location: { directory: input.directory } }),
    tree: {
      list: listDir,
      refresh: (dir: string) => listDir(dir, { force: true }),
      expand: (raw: string, behavior?: { list?: boolean }) => {
        const dir = path.normalizeDir(raw)
        editDir(dir, (state) => ({ ...state, expanded: true }))
        if (behavior?.list !== false) void listDir(dir)
      },
      collapse: (raw: string) => editDir(path.normalizeDir(raw), (state) => ({ ...state, expanded: false })),
    },
    searchFiles: (query: string, options?: { limit?: number; signal?: AbortSignal }) => search(query, "file", options),
    searchFilesAndDirectories: (query: string) => search(query, undefined),
  }
}

export type Files = ReturnType<typeof createFiles>

/** Replace a directory's children, dropping removed entries and everything under removed folders. */
export function applyListing(state: FilesState, dir: string, nodes: FileNode[]): FilesState {
  const previous = state.dir[dir]?.children ?? []
  const next = new Set(nodes.map((node) => node.path))
  const removedDirs = previous.filter((child) => !next.has(child) && state.node[child]?.type === "directory")
  const removed = new Set(previous.filter((child) => !next.has(child)))
  const node = Object.fromEntries(
    Object.entries(state.node).filter(
      ([key]) => !removed.has(key) && !removedDirs.some((folder) => key.startsWith(folder + "/")),
    ),
  )
  nodes.forEach((item) => (node[item.path] = item))
  const current = state.dir[dir] ?? { expanded: false }
  return {
    ...state,
    node,
    dir: { ...state.dir, [dir]: { ...current, loaded: true, loading: false, children: [...next] } },
  }
}

/** The loaded children of a directory, in listing order. */
export function childrenOf(state: FilesState, dir: string) {
  return (state.dir[dir]?.children ?? []).flatMap((id) => {
    const node = state.node[id]
    return node ? [node] : []
  })
}
