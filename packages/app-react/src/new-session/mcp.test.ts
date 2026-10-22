import { expect, test } from "bun:test"
import { fakeServer } from "../session/test"
import { applyMcp, toggleMcp, type McpHost } from "./mcp"

const text = {
  unavailable: (name: string) => `unavailable ${name}`,
  signIn: (name: string) => `sign in ${name}`,
  notReady: (name: string) => `not ready ${name}`,
  interactiveForm: (name: string) => `form ${name}`,
}

function host(): McpHost & { opened: string[]; failures: unknown[] } {
  const opened: string[] = []
  const failures: unknown[] = []
  return { text, opened, failures, openExternal: (url) => void opened.push(url), failed: (error) => void failures.push(error) }
}

function server(initial: Record<string, string>, options: { failConnect?: boolean } = {}) {
  const status = { ...initial }
  const list = () => ({
    location: { directory: "/wt" },
    data: Object.entries(status).map(([name, value]) => ({ name, integrationID: `int-${name}`, status: { status: value } })),
  })
  const fake = fakeServer({
    "mcp.list": list,
    "mcp.connect": (input: { server: string }) => {
      if (options.failConnect) throw new Error("connect failed")
      status[input.server] = "connected"
    },
    "mcp.disconnect": (input: { server: string }) => void (status[input.server] = "disabled"),
    "mcp.resource.catalog": () => ({ location: { directory: "/wt" }, data: { resources: [], templates: [] } }),
    "integration.get": () => ({ data: { id: "int-docs", methods: [{ id: "oauth", type: "oauth" }] } }),
    "integration.oauth.connect": () => ({ data: { url: "https://auth.test/authorize" } }),
  })
  return { ...fake, status }
}

test("switches the draft's servers in the new directory", async () => {
  const fake = server({ docs: "disabled", search: "connected" })
  expect(await applyMcp(fake.server, "/wt", { docs: true, search: false }, host())).toBe(true)
  expect(fake.status).toEqual({ docs: "connected", search: "disabled" })
})

test("a server missing in the directory is said in words", async () => {
  const fake = server({})
  await expect(applyMcp(fake.server, "/wt", { docs: true }, host())).rejects.toThrow("unavailable docs")
})

test("a server that needs a sign-in stops the send", async () => {
  const fake = server({ docs: "needs_auth" })
  await expect(applyMcp(fake.server, "/wt", { docs: true }, host())).rejects.toThrow("sign in docs")
})

test("nothing switched means nothing to do", async () => {
  const fake = server({})
  expect(await applyMcp(fake.server, "/wt", {}, host())).toBe(true)
  expect(fake.calls).toEqual([])
})

test("turning on a server that needs a sign-in opens its sign-in page", async () => {
  const fake = server({ docs: "needs_auth" })
  const mcp = host()
  await toggleMcp(fake.server, { name: "docs", enabled: true, directory: "/wt" }, mcp)
  expect(mcp.opened).toEqual(["https://auth.test/authorize"])
})

test("a toggle that fails is said and stops the send", async () => {
  const fake = server({ docs: "disabled" }, { failConnect: true })
  const mcp = host()
  expect(await applyMcp(fake.server, "/wt", { docs: true }, mcp)).toBe(false)
  expect(mcp.failures).toHaveLength(1)
})

test("the send waits for a switch still going in that directory", async () => {
  const fake = server({ docs: "connected" })
  const failed = Promise.resolve(false)
  expect(await applyMcp(fake.server, "/wt", {}, host(), failed)).toBe(false)
  expect(await applyMcp(fake.server, "/wt", {}, host(), Promise.resolve(true))).toBe(true)
})
