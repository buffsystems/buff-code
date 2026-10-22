import { expect, test } from "bun:test"
import { measureThumbs, offsetFromThumb } from "./scroll-view"

const box = { clientHeight: 100, scrollHeight: 100, scrollTop: 0, clientWidth: 200, scrollWidth: 400, scrollLeft: 0 }

test("only an overflowing axis shows a thumb, sized to the visible share", () => {
  const thumbs = measureThumbs({ ...box, rtl: false })
  expect(thumbs.vertical.show).toBe(false)
  expect(thumbs.horizontal).toEqual({ show: true, size: 92, start: 8 })
})

test("a right-to-left viewport starts its thumb at the right end and moves it left", () => {
  expect(measureThumbs({ ...box, rtl: true }).horizontal.start).toBe(100)
  expect(measureThumbs({ ...box, scrollLeft: -200, rtl: true }).horizontal.start).toBe(8)
})

test("a dragged thumb maps back to the scroll offset, reversed right to left", () => {
  const drag = { trackStart: 0, grab: 0, clientSize: 200, scrollSize: 400, thumbSize: 92 }
  expect(offsetFromThumb({ ...drag, pointer: 8 })).toBe(0)
  expect(offsetFromThumb({ ...drag, pointer: 100 })).toBe(200)
  expect(offsetFromThumb({ ...drag, pointer: 8, reverse: true })).toBe(200)
})
