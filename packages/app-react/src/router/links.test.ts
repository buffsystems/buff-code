import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { createMemoryHistory } from "./history"
import { delegateLinks } from "./links"

const cleanups: (() => void)[] = []
const blank = window.location.href
// Same-origin needs an origin: the window's page, not happy-dom's about:blank.
const dom = (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM
beforeAll(() => dom.setURL("http://window/"))
afterAll(() => dom.setURL(blank))
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.innerHTML = ""
})

function setup() {
  const history = createMemoryHistory("/")
  cleanups.push(delegateLinks(history))
  return history
}

function anchor(href: string, attributes: Record<string, string> = {}) {
  const a = document.createElement("a")
  a.href = href
  Object.entries(attributes).forEach(([name, value]) => a.setAttribute(name, value))
  a.append(document.createElement("span"))
  document.body.append(a)
  return a
}

function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })
  target.dispatchEvent(event)
  return event
}

test("a plain click on any same-origin anchor navigates in the window", () => {
  const history = setup()
  const event = click(anchor("/server/abc/session/ses_1?x=1#m").firstElementChild!)
  expect(event.defaultPrevented).toBe(true)
  expect(history.location.get()).toEqual({ pathname: "/server/abc/session/ses_1", search: "?x=1", hash: "#m" })
})

test("the replace attribute replaces the current entry", () => {
  const history = setup()
  history.navigate("/settings")
  click(anchor("/workflows", { replace: "" }))
  history.back()
  expect(history.location.get().pathname).toBe("/")
})

test("modified, non-primary, targeted, download, external and cross-origin clicks stay native", () => {
  const history = setup()
  const cases = [
    click(anchor("/a"), { ctrlKey: true }),
    click(anchor("/a"), { metaKey: true }),
    click(anchor("/a"), { shiftKey: true }),
    click(anchor("/a"), { altKey: true }),
    click(anchor("/a"), { button: 1 }),
    click(anchor("/a", { target: "_blank" })),
    click(anchor("/a", { download: "" })),
    click(anchor("/a", { rel: "noopener external" })),
    click(anchor("https://elsewhere.example/a")),
  ]
  expect(cases.map((event) => event.defaultPrevented)).toEqual(cases.map(() => false))
  expect(history.location.get().pathname).toBe("/")
})

test("a click another handler already took is left alone", () => {
  const history = setup()
  const a = anchor("/settings")
  a.addEventListener("click", (event) => event.preventDefault())
  click(a)
  expect(history.location.get().pathname).toBe("/")
})

test("disposing stops the delegation", () => {
  const history = createMemoryHistory("/")
  delegateLinks(history)()
  expect(click(anchor("/settings")).defaultPrevented).toBe(false)
  expect(history.location.get().pathname).toBe("/")
})
