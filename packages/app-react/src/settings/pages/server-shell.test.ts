import { expect, test } from "bun:test"
import { shellOptions } from "./server-shell"

test("shells sharing a name are told apart by path; an unlisted configured shell is kept", () => {
  const options = shellOptions({
    shells: [
      { path: "/bin/zsh", name: "zsh", acceptable: true },
      { path: "/bin/bash", name: "bash", acceptable: true },
      { path: "/usr/local/bin/bash", name: "bash", acceptable: false },
    ],
    current: "fish",
  })
  expect(options.map((option) => [option.id, option.value, option.terminalOnly])).toEqual([
    ["auto", "", false],
    ["/bin/zsh", "zsh", false],
    ["/bin/bash", "/bin/bash", false],
    ["/usr/local/bin/bash", "/usr/local/bin/bash", true],
    ["fish", "fish", false],
  ])
})
