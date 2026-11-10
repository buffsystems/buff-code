// Окно контекста (#837): диалог /context предлагает максимум модели и пресеты в пределах её окна,
// выбор уходит в потолок; свой размер — числом через запрос.
import { expect, test } from "bun:test"
import { CliRenderEvents, InputRenderable, TextareaRenderable } from "@opentui/core"
import { once } from "node:events"
import type { ModelInfo } from "@opencode/client"
import { DialogContextLimit } from "../../src/component/dialog-context-limit"
import { model, renderLocal } from "../fixture/local"

const wide = (): ModelInfo => ({ ...model("wide"), limit: { context: 400_000, output: 1_000 } })

async function focusReady(setup: Awaited<ReturnType<typeof renderLocal>>) {
  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
}

test("lists the model's maximum and the presets that fit, and a pick becomes the cap", async () => {
  await using setup = await renderLocal({ models: [wide()] })
  expect(setup.local.contextLimit.current()).toBe(0)
  setup.dialog.replace(() => <DialogContextLimit />)
  await setup.waitForFrame((frame) => frame.includes("Выбор окна контекста") && frame.includes("Максимум модели, 400k"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Компактный, 64k")
  expect(frame).toContain("Средний, 200k")
  expect(frame).not.toContain("Большой")
  expect(frame).toContain("Свой размер…")
  await focusReady(setup)
  await setup.mockInput.typeText("Средний")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.contextLimit.current()).toBe(200_000)
})

test("a custom size is typed in tokens and must fit the model's window", async () => {
  await using setup = await renderLocal({ models: [wide()] })
  setup.dialog.replace(() => <DialogContextLimit />)
  await setup.waitForFrame((frame) => frame.includes("Свой размер…"))
  await focusReady(setup)
  await setup.mockInput.typeText("Свой размер")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Лимит контекста в токенах"))
  // The prompt's field is a textarea that takes focus a tick after it paints.
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("150k")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.contextLimit.current()).toBe(150_000)
})
