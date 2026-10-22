// The Buff Code window also reads the Buff server's own RPCs (/api/rpc/buff.*) on every screen.
// The mock answers them like a freshly signed-in install: no marks, skills, hooks or MCP servers,
// a clean git checkout, the organization "e2e" chosen as context and a funded balance — so the
// specs see the window as a Buff user does, without failed requests or the first-run context
// dialog. A method the table does not know fails the way the real server answers one it has no
// handler for.

/** The Buff sign-in, as the integration list reports it: a stored credential for the "buff" provider. */
export const buffIntegration = {
  id: "buff",
  name: "Buff",
  methods: [],
  connections: [{ type: "credential", label: "e2e@buff.test" }],
}

const marks = { pinned: [], archived: [], groups: [], membership: {} }

const context = { org: "e2e", project: null, spaces: [] }

const billing = {
  org: context.org,
  balanceRub: 1000,
  daysLeft: null,
  low: false,
  exhausted: false,
  tariff: null,
  priceInputRubPerM: null,
  priceOutputRubPerM: null,
  mine: { windowDays: 30, totalRub: 0, days: [] },
  cabinetUrl: "",
}

const outputs: Record<string, (input: unknown) => unknown> = {
  "buff.session-marks/get": () => marks,
  "buff.session-marks/change": () => marks,
  "buff.locale/get": () => "en",
  "buff.locale/set": (input) => input,
  "buff.trust/get": () => ({ askFirst: true }),
  "buff.trust/set": (input) => input,
  "buff.skill/list": () => ({ skills: [], sources: [] }),
  "buff.custom/list": () => [],
  "buff.hook/list": () => [],
  "buff.mcp/list": () => [],
  "buff.memory/list": () => ({ enabled: true, files: [] }),
  "buff.snapshot-git/status": () => ({ ready: true, repository: true }),
  "buff.git/state": () => ({ branch: "main", ahead: 0, behind: 0, changes: [] }),
  "buff.git/branches": () => ["main"],
  "buff.git/log": () => [],
  "buff.goal/get": () => ({}),
  "buff.context/get": () => context,
  "buff.context/set": () => context,
  "buff.context/lastDirectory": () => null,
  "buff.context/options": () => ({ orgs: [context.org], projects: [], spaces: [] }),
  "buff.billing/get": () => billing,
  "buff.side/list": () => ({ sides: [] }),
  "buff.automation/list": () => ({ automations: [] }),
  "buff.workflow/list": () => ({ saved: [], invalid: [] }),
  "buff.search/sessions": () => [],
  "buff.turn/preview": () => ({ snapshots: true, files: [] }),
}

export type BuffRpcResult = { output: unknown } | { error: { type: string; message: string } }

export function buffRpc(rpcID: string, method: string, input: unknown): BuffRpcResult {
  const output = outputs[`${rpcID}/${method}`]
  if (output) return { output: output(input) }
  return { error: { type: "rpc.method_not_found", message: `No mock for RPC ${rpcID}.${method}` } }
}

/** The same answers for a spec that routes /api/** itself: the HTTP reply for an /api/rpc/ path. */
export function buffRpcReply(pathname: string, body: unknown) {
  const match = pathname.match(/^\/api\/rpc\/([^/]+)\/([^/]+)$/)
  if (!match) return
  const input = typeof body === "object" && body !== null && "input" in body ? body.input : undefined
  const result = buffRpc(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), input)
  if ("error" in result) return { status: 400, json: { _tag: "RpcError", ...result.error } }
  return { status: 200, json: { output: result.output } }
}
