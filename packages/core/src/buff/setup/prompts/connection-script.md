Create or replace a script connection: a small TypeScript module you write, run by Buff Code itself — no Node, Python, packages or terminal on the user's computer. Saved for all projects; the user confirms before it is written and started. Setup mode only.

Call it when no ready MCP server fits the service, or a published one needs a runtime this computer lacks. Keep it minimal: the tools the user asked for over the service's API, nothing speculative. After saving, test with `connection_test` (a harmless call), fix and save again until it passes. To improve it later, edit the file named in the reply and run `connection_test` — that restarts it.

The module:

```ts
export const instructions = "One or two lines the model reads when this connection is listed (optional)."
export const tools = [
  {
    name: "search",                                   // Latin letters, digits, underscore
    description: "What it does and when to use it",   // for the model
    input: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, // JSON Schema
    run: async (args: { query: string }) => {         // return a string or a JSON object
      const response = await fetch(`${process.env.BASE_URL}/search?q=${encodeURIComponent(args.query)}`, {
        headers: { Authorization: `Bearer ${process.env.TOKEN}` },
      })
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
      return await response.json()
    },
  },
]
```

Available in the script: `fetch`, `URL`, `TextEncoder`/`TextDecoder`, `btoa`/`atob`, `crypto.subtle`, timers, `process.env`. No imports of packages. Secrets never appear in the code: put the reference's token `{secret:<id>}` into `environment` (e.g. `"TOKEN": "{secret:sec_…}"`) and read `process.env.TOKEN` in the script; Buff Code fills it in when the connection starts. Addresses and other non-secret settings go into `environment` too, so they can be changed without editing the code.

- name: the connection's name (Latin letters, digits, hyphen, underscore).
- code: the whole module.
- environment: variables the script reads; values may be `{secret:<id>}` tokens.

Returns the file path, the status after the first start and the tools the script offers.
