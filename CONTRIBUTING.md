# Contributing to Buff Code

Thank you for helping. Issues and pull requests are welcome.

## How this repository works

This repository is a **snapshot**: each Buff release adds one commit with the source of that
release. Development happens in our tree, and the next release brings it here.

So a pull request is not merged with the GitHub button. When we accept it, we apply your change
to our tree — your authorship is kept in the commit — and it appears here with the next release.
We then close the pull request with a link to that release.

## Good changes to propose

- Bug fixes, with a way to reproduce the bug.
- Fixes for a platform, terminal or shell we handle wrongly.
- Documentation and translation fixes.

For a larger feature, please open an issue first so we can agree on the approach.

## Before you open a pull request

- One focused change per pull request.
- Run the tests of the package you changed, e.g. `cd packages/core && bun run test`.
- `bun turbo typecheck` passes.
- Explain **why** in the description, not only what.

## Upstream

Buff Code is a fork of [opencode](https://github.com/anomalyco/opencode). A fix that belongs to the
core is often better sent upstream as well — we pick up upstream releases regularly.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
