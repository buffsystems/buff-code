import { expect, test } from "bun:test"
import { focusLost, nearestBox } from "./focus-box"

function page() {
  document.body.innerHTML = `
    <section id="a"><div class="docks"><button id="allow">Allow</button></div><div data-component="composer-editor" id="box-a" tabindex="0"></div></section>
    <section id="b"><div data-component="composer-editor" id="box-b" tabindex="0"></div></section>`
}

test("the box is the one of the same session view", () => {
  page()
  expect(nearestBox(document.getElementById("allow"))?.id).toBe("box-a")
  expect(nearestBox(document.getElementById("b")!.firstElementChild)?.id).toBe("box-b")
  expect(nearestBox(null)).toBeNull()
})

test("focus is lost when nothing holds it or its holder is gone", () => {
  page()
  const allow = document.getElementById("allow")!
  allow.focus()
  expect(focusLost()).toBe(false)
  allow.remove()
  expect(focusLost()).toBe(true)
})
