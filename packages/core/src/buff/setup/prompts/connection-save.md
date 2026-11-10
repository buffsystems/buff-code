Save a connection (an MCP server) and start it: Buff Code writes it to the user's configuration (`scope: "user"`, all projects) or the project's (`scope: "project"`), connects, and tells you the status. The user confirms before anything is written or run. Setup mode only.

Call it once you know how the service is reached and have collected what it needs with `setup_form`. Saving an existing name replaces it — use that to fix settings after a failed test.

- name: Latin letters, digits, hyphen, underscore; stable, you will refer to it.
- config: `{ "type": "local", "command": ["program", "arg", …], "environment": { "VAR": "value" } }` for a program on this computer, or `{ "type": "remote", "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }` for a server reachable by address; `"oauth": false` when the remote server takes a key in a header instead of signing in; `"oauth": { "client_id": "…", "client_secret": "…" }` when the service gave the user an app of its own.
- Secrets: never the value — the reference's token `{secret:<id>}` in the environment, header, argument or OAuth client secret; Buff Code fills it in when the server starts.

Returns the status after the connection attempt and the tools it offers. "Sign-in needed" means call `connection_auth`. Not connected — read the reason, fix, save again; do not report success.
