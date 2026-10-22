// Buff (#467): проект, появившийся после загрузки списка, становится известен хранилищу сразу —
// иначе окно не знает, что в каталоге есть git, пока его не перезагрузят.
import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const project = (id: string, canonical: string) => ({
  id,
  canonical,
  vcs: "git",
  time: { created: 1, updated: 1 },
  sandboxes: [],
})

function setup() {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const known = [project("project_first", "/projects/first")]
  const listed = { times: 0 }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (url.pathname === "/api/project") {
        listed.times++
        return Response.json(known)
      }
      if (url.pathname === "/api/location") {
        const directory = url.searchParams.get("location[directory]") ?? url.searchParams.get("directory") ?? ""
        const owner = known.find((item) => item.canonical === directory) ?? known[0]
        return Response.json({ directory, project: { id: owner.id, directory, canonical: directory } })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    },
  })
  const root = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/projects/first",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))
  return { ...root, known, listed, emit }
}

async function eventually(done: () => boolean) {
  for (let left = 200; left > 0 && !done(); left--) await Bun.sleep(5)
  return done()
}

test("a location whose project the store has not seen brings the project in", async () => {
  const { data, known, dispose } = setup()
  try {
    await data.project.sync()
    known.push(project("project_added", "/projects/added"))
    await data.location.syncInfo({ directory: "/projects/added" })
    expect(await eventually(() => data.project.get("project_added") !== undefined)).toBe(true)
    expect(data.project.get("project_added")?.vcs).toBe("git")
  } finally {
    dispose()
  }
})

test("a worktree resolved for an unseen project brings the project in", async () => {
  const { data, known, emit, dispose } = setup()
  try {
    await data.project.sync()
    known.push(project("project_added", "/projects/added"))
    emit({
      id: "evt_resolved",
      created: 2,
      type: "worktree.resolved",
      data: { projectID: "project_added", directory: "/projects/added", previous: "global" },
    } as OpenCodeEvent)
    expect(await eventually(() => data.project.get("project_added") !== undefined)).toBe(true)
  } finally {
    dispose()
  }
})

test("a location of a known project asks for nothing more", async () => {
  const { data, listed, dispose } = setup()
  try {
    await data.project.sync()
    await data.location.syncInfo({ directory: "/projects/first" })
    await Bun.sleep(20)
    expect(listed.times).toBe(1)
  } finally {
    dispose()
  }
})

test("a project the server never lists is looked for once, not on every visit", async () => {
  const { data, listed, emit, dispose } = setup()
  const resolved = (id: string): OpenCodeEvent =>
    ({
      id,
      created: 2,
      type: "worktree.resolved",
      data: { projectID: "project_ghost", directory: "/projects/ghost", previous: "global" },
    }) as OpenCodeEvent
  try {
    await data.project.sync()
    emit(resolved("evt_1"))
    await Bun.sleep(20)
    emit(resolved("evt_2"))
    await Bun.sleep(20)
    expect(listed.times).toBe(2)
  } finally {
    dispose()
  }
})
