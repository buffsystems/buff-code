import { expect, test } from "bun:test"
import { createDiffFind } from "./diff-find"

function viewer() {
  const wrapper = document.createElement("div")
  const host = document.createElement("div")
  const root = host.attachShadow({ mode: "open" })
  root.innerHTML =
    '<div data-content><div data-line="1"><span>const value</span> = 1</div><div data-line="2">value += <b>value</b></div></div>'
  wrapper.append(host)
  document.body.append(wrapper)
  return { wrapper, root }
}

test("counts every match in the diff's lines and steps through them", async () => {
  const target = viewer()
  const find = createDiffFind({ wrapper: () => target.wrapper, getRoot: () => target.root })
  const stop = find.mount()
  find.open()
  find.setQuery("VALUE")
  expect(find.state.get()).toMatchObject({ open: true, count: 3, index: 0 })
  find.next(1)
  find.next(1)
  find.next(1)
  expect(find.state.get().index).toBe(0)
  find.next(-1)
  expect(find.state.get().index).toBe(2)
  find.close()
  expect(find.state.get()).toMatchObject({ open: false, query: "", count: 0 })
  stop()
})
