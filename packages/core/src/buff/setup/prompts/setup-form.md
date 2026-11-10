Show the user a form and get their answers: addresses, logins, paths, choices, numbers, a link they must open — and secrets. Setup mode only.

Call it the moment you know what the connection needs from the user and the user has agreed to connect it. Ask everything one connection needs in one form; a second form only when the first answers decide what else is needed. Never ask for a password, key or token in the chat — only through a `secret` field here.

- Every field: `key` (your identifier), `label` and `hint` in the user's words (where to find the value, what it looks like), `required`.
- `secret`: you receive a reference `secret:<id>`, never the value. Put `{secret:<id>}` into the connection's environment, header, argument or OAuth client secret; Buff Code fills in the value when the connection starts.
- `choice` (one) and `multi` (several) need `options`; add `custom: true` when the user may type an answer of their own. `link` needs `url` (the user opens it — e.g. to allow access or create a key — and confirms).
- `text` values you may read and use. Do not ask for anything you can look up yourself.

Answers come back by key; an empty optional field is "(empty)". A dismissed form ends your turn.
