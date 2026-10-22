// The titlebar's right slot (#584): a screen renders <TitlebarRight> to put its controls at the
// titlebar's end; the most recently mounted one shows.

import { createContext, use, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { createStore } from "../../core/store"
import { useStore } from "../../react/use-store"

function createRightSlot() {
  const state = createStore<{ mount?: HTMLElement; registrations: symbol[] }>({ registrations: [] })
  return {
    state,
    setMount: (mount: HTMLElement | null) => state.set((current) => ({ ...current, mount: mount ?? undefined })),
    register(id: symbol) {
      state.set((current) => ({ ...current, registrations: [...current.registrations, id] }))
      return () =>
        state.set((current) => ({ ...current, registrations: current.registrations.filter((item) => item !== id) }))
    },
  }
}

const RightSlotContext = createContext<ReturnType<typeof createRightSlot> | undefined>(undefined)

export function TitlebarRightProvider(props: { children?: ReactNode }) {
  const [slot] = useState(createRightSlot)
  return <RightSlotContext value={slot}>{props.children}</RightSlotContext>
}

function useRightSlot() {
  const slot = use(RightSlotContext)
  if (!slot) throw new Error("TitlebarRight must be used inside TitlebarRightProvider")
  return slot
}

export function TitlebarRightMount(props: { vertical?: boolean }) {
  const slot = useRightSlot()
  return (
    <div
      ref={slot.setMount}
      id="opencode-titlebar-right"
      className={props.vertical ? "flex w-full shrink-0 flex-col" : "flex shrink-0 items-center justify-end"}
    />
  )
}

export function TitlebarRight(props: { children?: ReactNode }) {
  const slot = useRightSlot()
  const [id] = useState(() => Symbol("titlebar-right"))
  useEffect(() => slot.register(id), [slot, id])
  const mount = useStore(slot.state, (state) => (state.registrations.at(-1) === id ? state.mount : undefined))
  return mount ? createPortal(props.children, mount) : null
}
