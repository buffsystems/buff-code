Sign the user in to a remote connection through the service itself (OAuth): the user gets a link to open, signs in there, and comes back; Buff Code stores what the service returned and reconnects. Setup mode only.

Call it when a remote connection reports "sign-in needed", or right after saving a remote connection that signs in this way. Tell the user in one line what will happen before calling. If the service needs an app of the user's own (client id and secret), collect those with `setup_form` first and save them in the connection's `oauth` settings.

Returns whether the sign-in completed and the connection's status afterwards. A dismissed form ends your turn.
