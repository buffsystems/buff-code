Test a connection: reconnect it if it is not connected and list the tools it offers. Outside Self-setup mode that is all it does — leave `tool` empty; to use the connection, call its own tool as usual. In Self-setup mode it can also make one trial call to prove the connection works.

Call it after `connection_save` or `connection_auth`, and whenever the user says a connection stopped working.

In Self-setup mode pick a harmless tool for the trial call — one that reads, lists or searches — with minimal arguments; never one that sends, deletes or changes. There, do not declare a connection working without a passed call.

- name: the connection.
- tool, args: the trial call (in Self-setup mode); leave `tool` empty to only reconnect and list tools.

Returns the status, the tools, and the trial call's result (shortened) or its error in words.
