import { afterEach, expect, test } from "bun:test"
import { act, useEffect } from "react"
import { useSessionView } from "./context"
import { SessionLayout } from "./layout"
import { collectSlots, type SessionSlot } from "./slots"
import { renderSessionSlot } from "./test"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

const slot = (name: SessionSlot["slot"], id: string, component: SessionSlot["component"]): SessionSlot => ({
  slot: name,
  id,
  component,
})

test("fills each slot and shows the side region only while open", () => {
  const actions: { toggle?: () => void } = {}
  function Toggle() {
    const view = useSessionView()
    actions.toggle = view.toggleReview
    return <button type="button">toggle</button>
  }
  const slots = collectSlots([
    { default: slot("timeline", "timeline", () => <p data-testid="timeline">timeline</p>) },
    { default: slot("composer", "composer", () => <p data-testid="composer">composer</p>) },
    {
      default: [slot("panel-actions", "toggle", Toggle), slot("side", "review", () => <p data-testid="side">side</p>)],
    },
  ])
  const view = renderSessionSlot(<SessionLayout slots={slots} />)
  cleanup.push(view.unmount)
  const chat = view.element.querySelector('[data-slot="session-chat-panel"]')
  expect(chat?.querySelector('[data-testid="timeline"]')).not.toBeNull()
  expect(chat?.querySelector('[data-testid="composer"]')).not.toBeNull()
  expect(view.element.querySelector('[data-slot="session-side-panel-presence"]')).toBeNull()
  act(() => actions.toggle?.())
  expect(view.element.querySelector('[data-slot="session-side-region"] [data-testid="side"]')).not.toBeNull()
})

test("a failing slot shows an error note and leaves the others", () => {
  const slots = collectSlots([
    {
      default: slot("timeline", "timeline", () => {
        throw new Error("boom")
      }),
    },
    { default: slot("composer", "composer", () => <p data-testid="composer">composer</p>) },
  ])
  const error = console.error
  console.error = () => undefined
  const view = renderSessionSlot(<SessionLayout slots={slots} />)
  console.error = error
  cleanup.push(view.unmount)
  expect(view.element.querySelector('[data-component="session-slot-error"]')?.getAttribute("data-slot-id")).toBe(
    "timeline",
  )
  expect(view.element.querySelector('[data-testid="composer"]')).not.toBeNull()
})

// happy-dom's media queries follow the viewport but never announce the change.
const happyDOM = (window as unknown as { happyDOM: { setViewport: (size: { width: number }) => void } }).happyDOM
const mediaLists: MediaQueryList[] = []
function resizeViewport(width: number) {
  happyDOM.setViewport({ width })
  mediaLists.forEach((list) => list.dispatchEvent(new Event("change")))
}

test("keeps the timeline mounted across the phone breakpoint", () => {
  const matchMedia = window.matchMedia
  window.matchMedia = (query: string) => {
    const list = matchMedia(query)
    mediaLists.push(list)
    return list
  }
  cleanup.push(() => {
    act(() => resizeViewport(1024))
    window.matchMedia = matchMedia
    mediaLists.length = 0
  })
  const mounts: string[] = []
  function Timeline() {
    useEffect(() => {
      mounts.push("mount")
    }, [])
    return <p data-testid="timeline">timeline</p>
  }
  const slots = collectSlots([{ default: slot("timeline", "timeline", Timeline) }])
  const view = renderSessionSlot(<SessionLayout slots={slots} />)
  cleanup.push(view.unmount)
  const timeline = view.element.querySelector('[data-testid="timeline"]')
  expect(timeline).not.toBeNull()
  act(() => resizeViewport(430))
  expect(view.element.querySelector("[data-mobile]")).not.toBeNull()
  expect(view.element.querySelector('[data-testid="timeline"]')).toBe(timeline)
  act(() => resizeViewport(1024))
  expect(view.element.querySelector("[data-mobile]")).toBeNull()
  expect(view.element.querySelector('[data-testid="timeline"]')).toBe(timeline)
  expect(mounts).toEqual(["mount"])
})
