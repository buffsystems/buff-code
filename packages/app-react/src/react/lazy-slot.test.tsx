import { afterEach, expect, test } from "bun:test"
import { act, Suspense, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { lazySlot } from "./lazy-slot"

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
})

const module = { Pane: () => <span>loaded pane</span> }

test("a preloaded slot renders its module in the first commit, without suspending", async () => {
  const slot = lazySlot(
    () => Promise.resolve(module),
    (loaded) => loaded.Pane,
  )
  await slot.preload()
  const element = document.createElement("div")
  root = createRoot(element)
  act(() =>
    root?.render(
      <Suspense fallback={<span>fallback</span>}>
        <slot.component />
      </Suspense>,
    ),
  )
  expect(element.textContent).toBe("loaded pane")
})

test("a slot rendered before its module loads suspends, then shows it", async () => {
  const gate = Promise.withResolvers<typeof module>()
  const slot = lazySlot(
    () => gate.promise,
    (loaded) => loaded.Pane,
  )
  const element = document.createElement("div")
  root = createRoot(element)
  act(() =>
    root?.render(
      <Suspense fallback={<span>fallback</span>}>
        <slot.component />
      </Suspense>,
    ),
  )
  expect(element.textContent).toBe("fallback")
  await act(async () => {
    gate.resolve(module)
    await gate.promise
  })
  expect(element.textContent).toBe("loaded pane")
})

test("a slot with a fallback shows it while its module loads", async () => {
  const gate = Promise.withResolvers<typeof module>()
  const slot = lazySlot(
    () => gate.promise,
    (loaded) => loaded.Pane,
    () => <span>title</span>,
  )
  const element = document.createElement("div")
  root = createRoot(element)
  act(() => root?.render(<slot.component />))
  expect(element.textContent).toBe("title")
  await act(async () => {
    gate.resolve(module)
    await gate.promise
  })
  expect(element.textContent).toBe("loaded pane")
})

for (const fallback of [undefined, () => <span>title</span>]) {
  test(`a slot that mounted before its module loaded is not remounted by a later render (${fallback ? "own fallback" : "outer boundary"})`, async () => {
    const gate = Promise.withResolvers<{ Pane: () => React.ReactNode }>()
    const mounts = { count: 0 }
    function Pane() {
      useEffect(() => {
        mounts.count++
      }, [])
      return <span>loaded pane</span>
    }
    const slot = lazySlot(
      () => gate.promise,
      (loaded) => loaded.Pane,
      fallback,
    )
    const element = document.createElement("div")
    root = createRoot(element)
    const render = (tick: number) =>
      root?.render(
        <Suspense fallback={<span>fallback</span>}>
          <slot.component key="slot" />
          <i>{tick}</i>
        </Suspense>,
      )
    act(() => render(0))
    await act(async () => {
      gate.resolve({ Pane })
      await gate.promise
    })
    expect(mounts.count).toBe(1)
    // A parent re-renders (a reconnect, a setting): the pane keeps its instance and its state.
    act(() => render(1))
    expect(element.textContent).toBe("loaded pane1")
    expect(mounts.count).toBe(1)
  })
}
