// The side conversations' input drafts (#464): «To a side conversation» leaves the selected
// fragment here and the tab shows it in its input. They live while the window is open.

import { createStore } from "../../core/store"

export const sideDrafts = createStore<Readonly<Record<string, string>>>({})

export const setSideDraft = (session: string, text: string) => sideDrafts.set((all) => ({ ...all, [session]: text }))

export const quoteForSide = (text: string) =>
  `${text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`
