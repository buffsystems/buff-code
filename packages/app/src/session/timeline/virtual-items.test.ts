import { afterEach, describe, expect, test } from "bun:test"
import { placeRowNodes, selectedRowKeys } from "./virtual-items"

function list(keys: string[]) {
  const root = document.createElement("div")
  keys.forEach((key) => {
    const row = document.createElement("div")
    row.dataset.timelineKey = key
    row.textContent = `Row ${key}`
    root.append(row)
  })
  document.body.append(root)
  return root
}

function select(start: Node, end: Node) {
  const selection = window.getSelection()!
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, end.textContent?.length ?? 0)
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe("selectedRowKeys", () => {
  test("keeps the rows a text selection spans", () => {
    const root = list(["a", "b", "c", "d"])
    const selection = select(root.children[1]!.firstChild!, root.children[2]!.firstChild!)
    expect(selectedRowKeys(root, selection)).toEqual(["b", "c"])
  })

  test("keeps nothing without a selection inside the list", () => {
    const root = list(["a", "b"])
    const outside = document.createElement("p")
    outside.textContent = "Outside"
    document.body.append(outside)
    expect(selectedRowKeys(root, select(outside.firstChild!, outside.firstChild!))).toEqual([])
    const caret = window.getSelection()!
    caret.collapse(root.children[0]!.firstChild!, 1)
    expect(selectedRowKeys(root, caret)).toEqual([])
    expect(selectedRowKeys(root, null)).toEqual([])
  })
})

describe("placeRowNodes", () => {
  const rows = (keys: string[]) =>
    new Map(keys.map((key) => [key, Object.assign(document.createElement("div"), { id: key })]))
  const order = (parent: Node) => [...parent.childNodes].map((node) => (node as HTMLElement).id)

  test("admits rows around the kept ones without detaching them", () => {
    const parent = document.createElement("div")
    const end = Object.assign(document.createElement("div"), { id: "end" })
    parent.append(end)
    const nodes = rows(["a1", "a2", "a3", "a4", "a5", "k1", "k2", "k3", "z"])
    const previous = ["k1", "k2", "k3", "z"].map((key) => nodes.get(key)!)
    placeRowNodes(parent, [], previous)
    const detached: string[] = []
    new MutationObserver((records) =>
      records.forEach((record) => record.removedNodes.forEach((node) => detached.push((node as HTMLElement).id))),
    ).observe(parent, { childList: true })
    const next = ["a1", "a2", "a3", "a4", "a5", "k1", "k2", "k3"].map((key) => nodes.get(key)!)
    placeRowNodes(parent, previous, next)
    expect(order(parent)).toEqual(["a1", "a2", "a3", "a4", "a5", "k1", "k2", "k3", "end"])
    return Promise.resolve().then(() => expect(detached).toEqual(["z"]))
  })

  test("moves a row only when its order changes", () => {
    const parent = document.createElement("div")
    const nodes = rows(["a", "b", "c"])
    const previous = ["a", "b", "c"].map((key) => nodes.get(key)!)
    placeRowNodes(parent, [], previous)
    placeRowNodes(
      parent,
      previous,
      ["c", "a", "b"].map((key) => nodes.get(key)!),
    )
    expect(order(parent)).toEqual(["c", "a", "b"])
  })
})
