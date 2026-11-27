Remove a connection: delete it from the configuration file it lives in, stop it, and delete the secrets it used. The user confirms first. Self-setup mode only.

Call it when the user asks to disconnect something, or to replace a connection that cannot be fixed — after telling them what they lose. Built-in servers of Buff Code cannot be removed: the call fails.

- name: the connection; Buff Code finds where it lives.
