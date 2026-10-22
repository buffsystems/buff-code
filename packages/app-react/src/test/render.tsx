import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

/** Mount a tree into a detached element for a test; returns the element and an unmount. */
export function render(node: ReactNode) {
  const element = document.createElement("div")
  document.body.append(element)
  const root = createRoot(element)
  act(() => root.render(node))
  return {
    element,
    unmount() {
      act(() => root.unmount())
      element.remove()
    },
  }
}

/** Let pending promises and the effects they trigger settle inside act(). */
export async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
