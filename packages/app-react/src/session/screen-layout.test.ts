import { expect, test } from "bun:test"
import { sessionScreenLayout, type ScreenLayoutInput } from "./screen-layout"

const input: ScreenLayoutInput = {
  desktop: true,
  review: false,
  terminal: false,
  placement: "side",
  sessionWidth: 600,
  terminalHeight: 280,
  split: false,
  row: { width: 1400, height: 800 },
  viewportHeight: 900,
}

test("closed panes leave the chat panel the whole row", () => {
  const layout = sessionScreenLayout(input)
  expect(layout.panelWidth).toBe("100%")
  expect(layout.sideVisible).toBe(false)
  expect(layout.regionHeight).toBe("0px")
})

test("the review keeps the chat panel at its stored width and fills the side column", () => {
  const layout = sessionScreenLayout({ ...input, review: true })
  expect(layout.panelWidth).toBe("600px")
  expect(layout.contentWidth).toBe("792px")
  expect(layout.regionHeight).toBe("800px")
  expect(layout.stacked).toBe(false)
})

test("beside the review, the terminal sits under it", () => {
  const layout = sessionScreenLayout({ ...input, review: true, terminal: true })
  expect(layout.stacked).toBe(true)
  expect(layout.regionHeight).toBe("512px")
  expect(layout.terminalHeight).toBe("280px")
  expect(sessionScreenLayout({ ...input, terminal: true }).terminalHeight).toBe("800px")
})

test("across the bottom, the terminal leaves the side column alone", () => {
  const layout = sessionScreenLayout({ ...input, terminal: true, placement: "bottom" })
  expect(layout.bottomTerminal).toBe(true)
  expect(layout.sideVisible).toBe(false)
})

test("the chat panel leaves the review its minimum, and phones show no side column", () => {
  expect(sessionScreenLayout({ ...input, review: true, sessionWidth: 1200 }).resizedWidth).toBe(912)
  expect(sessionScreenLayout({ ...input, desktop: false, review: true }).sideVisible).toBe(false)
})
