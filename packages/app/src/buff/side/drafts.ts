import { createSignal } from "solid-js"

/**
 * Черновики полей ввода побочных диалогов (#464): «В побочный диалог» кладёт сюда выделенный
 * фрагмент, вкладка показывает его в своём поле. Живут, пока открыто окно.
 */

const [drafts, setDrafts] = createSignal<Readonly<Record<string, string>>>({})

export const sideDraft = (session: string) => drafts()[session] ?? ""
export const setSideDraft = (session: string, text: string) => setDrafts((all) => ({ ...all, [session]: text }))
export const quoteForSide = (text: string) =>
  `${text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`
