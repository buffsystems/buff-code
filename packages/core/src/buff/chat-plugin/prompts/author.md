# Writing a chat plugin

A chat plugin draws a fenced code block of a chat answer as an interactive visual, in place of the code. You write three things: the view (a page that draws the block), the guide (how a model writes the block) and examples (blocks the plugin is tested on).

## The view

One self-contained HTML fragment: markup, one `<style>`, one `<script>`. It runs in an isolated frame with no network at all — nothing can be fetched or linked: no CDN scripts, web fonts, remote images, `fetch`, WebSocket. Everything it needs is written inline; prefer plain DOM, SVG or canvas to a pasted library.

The page has `window.buff`:

- `buff.onBlock(fn)` — `fn({ name, text, complete })` gets the block's text. While the answer is still being written it is called again and again with `complete: false` and a text that may stop mid-line: draw what parses, keep the last good drawing, do not throw. With `complete: true` the block is whole; an error thrown then is shown to the user as a failure, with the raw block under it. `fn` may return a promise.
- `buff.host` — `{ theme: "light" | "dark", locale }`; `buff.onHost(fn)` is called when they change. Use `locale` for numbers, dates and your own labels.
- `buff.sendMessage(text)` — sends `text` into the chat as the user's own message. Works only right after the user clicked, tapped or typed inside the visual. For "tell me more about this" actions; the control must say what it will ask.
- `buff.updateContext(text)` — quietly tells the model what the user set in the visual (a filter, a selection); the model knows it with the user's next message. One short line; `""` clears it.
- `buff.setState(value)`, `buff.state` — JSON kept for this visual when its page is rebuilt (scrolled far away and back).
- `buff.openLink(url)` — asks the user, then opens an http(s) address outside the app. A plain `<a href>` does nothing.

Size: the frame is as wide as the chat's text and as tall as your content, up to about 700 px (taller content scrolls inside). Never set a fixed pixel width: lay out fluidly from 280 px (a phone) to 760 px.

## The look: the app's design system

Colours and fonts are CSS variables, set on `:root` and updated when the theme changes. The app may have any number of themes: never hard-code a colour, never branch on a theme's name — paint only with these.

- Surfaces: `--color-background-primary` (the chat's page; the frame is transparent over it), `--color-background-secondary`, `--color-background-tertiary`.
- Text: `--color-text-primary`, `--color-text-secondary`, `--color-text-tertiary`.
- Lines: `--color-border-primary`, `--color-border-secondary`.
- Accent: `--color-accent`, `--color-accent-hover`, `--color-accent-text` (text on the accent).
- Status pairs: `--color-background-info|success|warning|danger` with `--color-text-info|success|warning|danger`.
- Data series: `--chart-1` … `--chart-8` in this fixed order — the first series is `--chart-1`, never skipped or cycled; past eight, fold the rest into "Other". `--chart-grid` and `--chart-axis` for a plot's quiet lines.
- Type and shape: `--font-sans`, `--font-mono`, `--border-radius-sm|md|lg`.

Body text is already 14px/1.5 in `--font-sans` and `--color-text-primary`. Words stay in the text colours, never in a series colour; a legend or labels always go with colour.

## Controls: the app's own components

The page already carries the app's design system, so anything a person presses or reads beside your drawing is written with its classes, not styled by you. They follow every theme, have the right sizes, focus rings and disabled states.

- Buttons: `<button class="ui-btn ui-btn--outline ui-btn--sm">`; one main action at most — `ui-btn--primary`; quiet ones — `ui-btn--ghost`. Sizes `ui-btn--sm`, `ui-btn--md`.
- A table: `<div class="ui-table-wrap"><table class="ui-table ui-table--compact">` with plain `th`/`td`; numbers in `<td class="ui-table__num">`.
- A status word: `<span class="ui-badge ui-badge--ok|warn|crit|info|neutral">`. A dot: `<span class="ui-dot ui-dot--ok">`.
- A note or a warning: `<div class="ui-callout ui-callout--info|warn|crit"><div class="ui-callout__text">…</div></div>`.
- A choice of a few: `<div class="ui-segmented"><button class="ui-segmented__item" aria-pressed="true">…`. Filter chips: `<button class="ui-chip">`.
- Fields: `<input class="ui-input ui-input--sm">`, `<select class="ui-select ui-select--sm">`, a label `<label class="ui-label">`.
- A figure with a caption: `<div class="ui-stat"><div class="ui-stat__label">…</div><div class="ui-stat__value">…</div></div>`, several in `<div class="ui-stat-grid ui-stat-grid--3">`.
- A boxed group: `<div class="ui-card"><div class="ui-card__content">…`. Nothing yet: `<div class="ui-empty ui-empty--inline">…</div>`.
- While there is nothing to draw: `<div class="ui-skeleton" style="height:240px"></div>`.

Name your own custom properties with a prefix of your plugin (`--funnel-gap`): every short name — `--bar`, `--card`, `--border`, `--ring`, `--primary` and the rest of the app's tokens — is already taken, and redefining one breaks the components.

Write your own CSS only for layout and for the drawing itself (the SVG or canvas), with the variables above. Motion is already switched off for a person who asked for less of it; if you animate a canvas yourself, check `matchMedia('(prefers-reduced-motion: reduce)')`.

## The block's format

Yours to design. Choose the simplest one a model writes reliably: JSON for structured data, `label: value` lines for a plain list. All data goes into the block. Be forgiving: ignore fields you do not know, and for data you cannot draw show a short message inside the visual rather than throwing.

## What the model reads, and when

A plugin costs the model's context like a skill does — in three steps, so write each part for its step.

1. **The description** is in every chat's prompt, always. Third person, at most 800 characters: what the visual shows and when to use it, with the words a user would say ("compare", "over time", "share of"). Not the format.
2. **The guide** is loaded only when a model decides to draw the block. Written for that model, not for the user: when the block fits and when a plain table is better, the exact format with every field, how many series or rows still read well, one compact example. Keep it short — the common case first.
3. **References** are for a large plugin only: one file per group of variants (per chart family, per layout), read only when that variant is drawn. The guide must say when to read each one: "For a map read guide/map.md". One level deep — a reference never points to another reference; a long one starts with its contents.

A plugin with one block and one format needs no references.

## Console text (optional)

`text`: a script that defines `function text(data, options)` returning a string — what the console shows in place of the visual. `data` is the block's text, `options.width` the columns available. Plain JavaScript: no DOM, no I/O.

## Examples

One to three blocks (for a plugin with references — at least one per reference), each exactly as a model writes it in a chat — a fenced code block named after the plugin's block — covering the usual case and an edge (a single item, long labels). `chat_plugin_test` draws every one of them.
