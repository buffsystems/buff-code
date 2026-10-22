import { afterEach, expect, test } from "bun:test"
import { dismissToast, showToast, toasts } from "./toast"

afterEach(() => toasts.get().forEach((item) => dismissToast(item.id)))

test("an identical toast on top pulses instead of stacking", () => {
  const first = showToast({ title: "Saved", variant: "success" })
  const again = showToast({ title: "Saved", variant: "success" })
  expect(again).toBe(first)
  expect(toasts.get()).toHaveLength(1)
  expect(toasts.get()[0]?.pulse).toBe(1)
  showToast("Other")
  expect(toasts.get()).toHaveLength(2)
})

test("a toast leaves after its duration unless persistent", async () => {
  showToast({ title: "Short", duration: 5 })
  showToast({ title: "Stays", persistent: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(toasts.get().map((item) => item.title)).toEqual(["Stays"])
})
