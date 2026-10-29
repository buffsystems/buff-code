<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="buff/assets/logo-dark.svg">
    <img src="buff/assets/logo.svg" alt="Buff Development" width="420">
  </picture>
</p>

<p align="center">
  <b>Buff Code — a development environment for engineers who write the code themselves.</b><br>
  A console and an app on your organisation's models, knowledge and connections — or on your own model.
</p>

<p align="center">
  <a href="https://github.com/buffsystems/buff-code/releases"><img alt="Release" src="https://img.shields.io/github/v/release/buffsystems/buff-code?label=release&color=2563eb"></a>
  <a href="LICENSE"><img alt="Licence" src="https://img.shields.io/badge/licence-MIT-64748b"></a>
  <a href="https://buff.systems/en/docs/buff-code"><img alt="Docs" src="https://img.shields.io/badge/docs-buff.systems-0b0d12"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="https://buff.systems/en/docs/buff-code">Documentation</a> ·
  <a href="README.md">Русский</a>
</p>

---

**Buff Code** is an agent in your project folder: the `buff` console and an app for Linux, macOS and Windows. It is the second way to work with [Buff](https://buff.systems/en): in the web app the platform drives a task — writes the code, checks it and brings it for acceptance; in Buff Code the engineer writes the code, and the model helps in their folder and terminal — with the same knowledge of the company.

Buff Code reaches models through the company connector, through LiteLLM or directly — any OpenAI-compatible endpoint works. Through the connector it also gets the rest of what the organisation has: knowledge, repositories, connections and a record of every turn in the dashboard.

<p align="center">
  <img src="buff/assets/shots/console.png" alt="Buff Code in a terminal: the model opened a knowledge base entry and answered by the team's rule" width="430">
  <img src="buff/assets/shots/window.png" alt="The Buff Code app: the agent's answer in the window" width="430">
</p>

## Install

The console, in one command:

```sh
curl -fsSL https://github.com/buffsystems/buff-code/releases/latest/download/install | bash
```

The script takes the console from this repository's [releases](https://github.com/buffsystems/buff-code/releases) and checks its checksum; if GitHub is unreachable it falls back to the mirror [buff.systems/en/downloads](https://buff.systems/en/downloads) (`BUFF_SOURCE=mirror` goes to the mirror directly).

The app for Linux, macOS and Windows is in the releases too. The `SHA256SUMS` list is signed with cosign, and the public key [`cosign.pub`](cosign.pub) is in the repository: `cosign verify-blob --key cosign.pub --signature SHA256SUMS.sig SHA256SUMS`. On first start Buff Code asks for your company connector's address and a code from the dashboard — or offers to connect your own model. Details: [Install](https://buff.systems/en/docs/buff-code/install) and [Sign-in](https://buff.systems/en/docs/buff-code/sign-in).

## What it does

| | |
|---|---|
| **Company knowledge at hand** | The model reads the organisation's knowledge base and proposes entries to it, searches the project's repositories without a local clone and calls the connector's tools — trackers, wikis, your MCP servers. |
| **Visible and reversible** | Under each answer — what the agent changed; a diff, a safe revert that checks for others' edits. Permission requests with a preview of the edit. |
| **Big tasks by plan** | A plan you approve, the agent's to-do list and a `/goal`: the agent keeps taking turns until a check confirms the result. Workflows — subagents in phases with checks. |
| **On a schedule** | Automations: tasks for the agent on a schedule, run by a service on the machine — even with the window closed. |
| **Git in the window** | What changed, a commit with a message from the agent, push, branches and history. |
| **Extensible** | Your own MCP servers, skills, commands, subagents, `AGENTS.md` memory and hooks — from the window's and the console's settings. |
| **Any models** | The organisation's models through the connector, a LiteLLM gateway or a provider directly — OpenRouter, Anthropic, OpenAI, Ollama, LM Studio and any OpenAI-compatible endpoint; they can be combined. |
| **Every turn recorded** | Development sessions are visible in the dashboard: a developer sees their own, the owner sees all; you can ask questions over the records. |

## How it works

Three ways to models — they can be combined:

```
                ┌─▶ company connector ──▶ Buff  (organisation models, knowledge, records)
Buff Code ──────┼─▶ LiteLLM              (an OpenAI-compatible gateway to models)
(developer's    └─▶ a provider directly  (OpenRouter, Anthropic, OpenAI, Ollama, LM Studio…)
 machine)
```

- **Through your company's [connector](https://github.com/buffsystems/buff-connector)** (the developer gateway) — the models the administrator chose, the knowledge base, project repositories and connection tools, a record of every turn in the dashboard. No provider keys on the developer's machine; sign-in with a code from the dashboard.
- **Through LiteLLM** — a gateway to models over an OpenAI-compatible API: the gateway's key instead of provider keys.
- **Directly** — to any OpenAI-compatible endpoint: a cloud provider with your own key or a local model.

Buff Code is a fork of [opencode](https://github.com/anomalyco/opencode) (MIT): we keep the core close to upstream and build our part on its extension points.

## Building from source

Requires [Bun](https://bun.sh) 1.4.

```sh
bun install
bun dev ~/my-project  # the console from source, on a project directory
```

`buff/Makefile` builds the release artifacts (`make -C buff dist`, `make -C buff desktop`) in a container, so the toolchain is the same everywhere.

## Contributing and licence

Bugs and proposals — via [issues](https://github.com/buffsystems/buff-code/issues), changes — via pull request; the rules are in [CONTRIBUTING.en.md](CONTRIBUTING.en.md) (including work with AI assistants). The repository is published as one snapshot per Buff release: accepted changes ship in the next one.

Licence — [MIT](LICENSE): © opencode, © Buff Systems. The design system is [buff-ui](https://github.com/buffsystems/buff-ui).
