import { createContext, use, useState, type ReactNode } from "react"
import { createStore } from "../core/store"
import { useStore } from "../react/use-store"

type Entry = { id: number; render: (close: () => void) => ReactNode }

/** The window's modal stack (#584): screens open dialogs by rendering into it, not in place. */
export function createDialogStack() {
  const entries = createStore<Entry[]>([])
  const sequence = { next: 0 }
  const close = (id: number) => entries.set((current) => current.filter((entry) => entry.id !== id))
  return {
    entries,
    /** Open a dialog; `render` receives its close. Returns the close too. */
    show(render: (close: () => void) => ReactNode) {
      const id = ++sequence.next
      entries.set((current) => [...current, { id, render }])
      return () => close(id)
    },
    close,
    closeAll: () => entries.set(() => []),
    active: () => entries.get().length > 0,
  }
}

export type DialogStack = ReturnType<typeof createDialogStack>

const DialogContext = createContext<DialogStack | undefined>(undefined)

export function DialogProvider(props: { stack?: DialogStack; children?: ReactNode }) {
  const [stack] = useState(() => props.stack ?? createDialogStack())
  const entries = useStore(stack.entries, (list) => list)
  return (
    <DialogContext value={stack}>
      {props.children}
      {entries.map((entry) => (
        <DialogSlot
          key={entry.id}
          entry={entry}
          close={() => stack.entries.set((list) => list.filter((item) => item !== entry))}
        />
      ))}
    </DialogContext>
  )
}

function DialogSlot(props: { entry: Entry; close: () => void }) {
  return <>{props.entry.render(props.close)}</>
}

export function useDialog() {
  const stack = use(DialogContext)
  if (!stack) throw new Error("useDialog must be used inside DialogProvider")
  return stack
}
