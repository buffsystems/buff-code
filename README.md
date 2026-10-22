<p align="center">
  <img src="buff/assets/mark-512.png" alt="Buff" width="96" height="96">
</p>
<h1 align="center">Buff Code</h1>
<p align="center">An AI coding agent for your terminal and desktop — with your own models, or with the models your company gives you through <a href="https://buff.systems">Buff</a>.</p>
<p align="center"><a href="README.ru.md">По-русски</a></p>

---

## Install

```bash
curl -fsSL https://buff.systems/install | bash
```

Desktop builds for Linux, macOS and Windows, and every release's checksums and signatures, are on
[buff.systems/downloads](https://buff.systems/downloads) and in this repository's
[releases](https://github.com/buffsystems/buff-code/releases).

## What it is

- **`buff`** — the agent in the terminal: reads and edits code, runs commands, works with git.
- **Buff Code desktop** — the same agent in a window, with sessions, diffs and review.
- **Your models or your company's.** Connect any provider you have a key or subscription for, or
  sign in to Buff and work with the models, tools and knowledge your organization set up.

Buff Code is a fork of [opencode](https://github.com/anomalyco/opencode) (MIT). We keep the core close
to upstream and build our part on its extension points.

## Build from source

Requires [Bun](https://bun.sh) 1.4.

```bash
bun install
bun dev ~/my-project  # the terminal app from source, on a project directory
```

`buff/Makefile` builds the release artifacts (`make -C buff dist`, `make -C buff desktop`) in a
container, so the toolchain is the same everywhere.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). This repository is
published as one snapshot per Buff release; accepted changes ship in the next one.

## License

[MIT](LICENSE) — © opencode, © Buff Systems.
