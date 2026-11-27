Create or replace a chat plugin: a visual drawn in the user's chats in place of a fenced code block. The user confirms before it is written. Where it is kept is not your choice: for this project only when the setup conversation was opened inside a project, for all projects otherwise; an existing plugin is replaced where it already lives. Self-setup mode only.

Call it after `chat_plugin_guide` and after the user agreed to what the visual should show. Then run `chat_plugin_test`, fix and save again until every example draws.

- id: the plugin's folder name (lowercase Latin letters, digits, hyphen).
- name, description: for the user and for the model that decides when to use it — the description is always in the prompt, so it says what the visual shows and when to use it, in at most 800 characters; the user's language.
- blocks: names of the code blocks it draws — specific lowercase words (`sales-funnel`), never a programming language's name.
- view: the whole page fragment.
- guide: how a model writes the block; loaded by the model only when it draws one.
- references: for a large plugin, files the guide points to as `guide/<name>.md`, each `{ name, text }`; otherwise empty.
- text: the console script, or empty.
- examples: each `{ name, block }` where `block` is the whole fenced code block.

Returns where it was saved (tell the user), the folder (edit its files there to improve the plugin) and warnings about the view.
