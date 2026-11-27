Save a connection (an MCP server) and start it: Buff Code writes it to the user's configuration, connects, and tells you the status. The user confirms before anything is written or run. Self-setup mode only.

Call it once you know how the service is reached and have collected what it needs with `setup_form`. Saving an existing name replaces that connection where it already lives (it is not moved) — use that to fix settings after a failed test.

Where it is kept is not an input and not your choice — it follows from where this setup conversation was opened. Inside a project: on the user's computer for that project only (other projects do not see it; it does not go into the project's repository). Outside any project: available in all projects. Only the user can switch it between "this project only" and "all projects", in the project's settings, MCP servers section — do not ask them which they want and do not promise to change it yourself.

- name: Latin letters, digits, hyphen, underscore; stable, you will refer to it.
- config: `{ "type": "local", "command": ["program", "arg", …], "environment": { "VAR": "value" } }` for a program on this computer, or `{ "type": "remote", "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }` for a server reachable by address; `"oauth": false` when the remote server takes a key in a header instead of signing in; `"oauth": { "client_id": "…", "client_secret": "…" }` when the service gave the user an app of its own.
- Secrets: never the value — the reference's token `{secret:<id>}` in the environment, header, argument or OAuth client secret; Buff Code fills it in when the server starts.

Returns where it was saved (this project only or all projects — tell the user), the status after the connection attempt and the tools it offers. "Sign-in needed" means call `connection_auth`. Not connected — read the reason, fix, save again; do not report success.
