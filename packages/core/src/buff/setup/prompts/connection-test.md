Test a connection: reconnect it if it is not connected, list the tools it offers, and optionally make one call to prove it works. Setup mode only.

Call it after `connection_save` or `connection_auth`, and whenever the user says a connection stopped working. For the trial call pick a harmless tool — one that reads, lists or searches — with minimal arguments; never one that sends, deletes or changes. Do not declare a connection working without a passed call.

- name: the connection.
- tool, args: the trial call; leave `tool` empty to only reconnect and list tools.

Returns the status, the tools, and the trial call's result (shortened) or its error in words.
