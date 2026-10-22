import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createStore } from "../core/store"
import { shallowEqual, useStore } from "./use-store"

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
})

function mount(node: React.ReactNode) {
  const element = document.createElement("div")
  root = createRoot(element)
  act(() => root?.render(node))
  return element
}

test("a row re-renders only when the slice it selected changes", () => {
  const store = createStore({ text: { a: "one", b: "two" } as Record<string, string> })
  const renders: Record<string, number> = {}
  function Row(props: { id: string }) {
    const text = useStore(store, (state) => state.text[props.id])
    renders[props.id] = (renders[props.id] ?? 0) + 1
    return <span>{text}</span>
  }
  const element = mount(
    <>
      <Row id="a" />
      <Row id="b" />
    </>,
  )
  act(() => store.set((state) => ({ text: { ...state.text, b: "two!" } })))
  expect(element.textContent).toBe("onetwo!")
  expect(renders).toEqual({ a: 1, b: 2 })
})

test("a derived selection with an equality check does not re-render on equal results", () => {
  const store = createStore({ ids: ["a", "b"], tick: 0 })
  let renders = 0
  function List() {
    const ids = useStore(store, (state) => state.ids.filter((id) => id !== "x"), shallowEqual)
    renders++
    return <span>{ids.join(",")}</span>
  }
  const element = mount(<List />)
  act(() => store.set((state) => ({ ...state, tick: state.tick + 1 })))
  expect(renders).toBe(1)
  act(() => store.set((state) => ({ ...state, ids: [...state.ids, "c"] })))
  expect(element.textContent).toBe("a,b,c")
  expect(renders).toBe(2)
})

test("shallowEqual compares arrays and plain objects one level deep", () => {
  expect(shallowEqual([1, 2], [1, 2])).toBe(true)
  expect(shallowEqual([1, 2], [1, 3])).toBe(false)
  expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
  expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  expect(shallowEqual("a", "a")).toBe(true)
})
