/** @jsxImportSource @opentui/solid */
// Рабочий контекст в строке состояния (#391): видно всегда, куда пишется работа.
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { ContextLabel } from "../../src/feature-plugins/buff/context"

const color = RGBA.fromInts(200, 200, 200)
const context = {
  theme: { text: { base: color, muted: color, feedback: { warning: { base: color } } } },
} as unknown as Context

async function frame(choice: Parameters<typeof ContextLabel>[0]["choice"], signedOut = false, own = false) {
  const app = await testRender(() => <ContextLabel context={context} choice={choice} signedOut={signedOut} own={own} />, {
    width: 80,
    height: 1,
  })
  try {
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("the chosen context is shown", async () => {
  expect(await frame({ org: "acme", project: "shop", spaces: ["handbook"] })).toContain("acme › shop · 1 пр.")
  expect(await frame({ org: "acme", project: null, spaces: [] })).toContain("acme › без проекта")
})

test("without a choice the label says how to make one", async () => {
  expect(await frame(null)).toContain("контекст не выбран · /project")
})

// #457: без входа модели нет — строка состояния говорит, как войти.
test("without a sign-in the label says there is no model and how to sign in", async () => {
  expect(await frame(null, true)).toContain("нет модели — войдите в Buff или подключите провайдер · /connect")
})

// #562: со своим провайдером модель есть — строка только напоминает о входе в Buff.
test("signed out with an own provider the label is no warning", async () => {
  expect(await frame(null, true, true)).toContain("Buff: вход не выполнен · /connect")
})
