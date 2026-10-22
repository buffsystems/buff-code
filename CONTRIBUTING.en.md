# Contributing

*[Русская версия](CONTRIBUTING.md)*

Thank you for helping with Buff Code. Issues and pull requests are welcome.

## How this repository works

This is a **snapshot**: each Buff release adds one commit with the source of that release, and development happens in our tree. So a pull request is not merged with the GitHub button: we carry an accepted change into our tree — your authorship is kept in the commit — and it appears here with the next release. We then close the pull request with a link to that release.

## What to send

- **Bugs** — via [issues](https://github.com/buffsystems/buff-code/issues). Include the version (`buff --version`), the OS and terminal or desktop, what you did, expected and got. Remove tokens and passwords from any output first.
- **Fixes, translations and documentation** — via pull request.
- **Proposals** — an issue marked «proposal»: what you want to do, why, and how it looks to the user. Discuss a large change in an issue first.

Questions about buying Enterprise and commercial ones belong at [buff.systems](https://buff.systems/#contact), not here.

## Pull requests

1. One change per PR. Small and described: what changes and **why**.
2. Check it: the tests of the package you changed (e.g. `cd packages/core && bun run test`) and `bun turbo typecheck`. Say in the PR where and how you checked.
3. Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `fix(scope): …`, `docs: …`.
4. The documentation is bilingual: if you edit `README.md`, edit `README.en.md` too (and the other way round).
5. Do not add secrets, binary files or dependencies without discussing it in an issue.

By sending changes you confirm that you have the right to contribute them and agree that they are distributed under the [MIT License](LICENSE).

## Changes made with AI

You may use AI assistants (Claude, Copilot, Buff and others) — we do too. The rules:

- **A human is responsible.** You have read and understood every line you send and checked it by running it. «The model did it» is not an argument in a review.
- **Say so.** Add a commit trailer `Assisted-with: <tool>` (e.g. `Assisted-with: Claude Code`). Do not list an AI as a human co-author (`Co-authored-by`).
- **No floods.** Do not send series of generated PRs or issues «just in case». An issue without a reproduction and a PR without a check are closed.
- **No one else's secrets or data.** Tokens, passwords and logs with personal data do not go into a model's context — and so not into a PR either.
- Text a model wrote for you (a PR description, a comment) should be to the point and shorter than you think.
