// A prompt a Buff page hands to a new draft (#448: «Fix in chat»): the Solid window's newDraft took
// it as an argument; here the page leaves it by draft id and the composer takes it once when it
// creates the draft's prompt.

import { createStore } from "../core/store"

const prompts = createStore<Record<string, string>>({})

export function leaveDraftPrompt(draftID: string, prompt: string) {
  prompts.set((current) => ({ ...current, [draftID]: prompt }))
}

/** The prompt left for a draft, once; undefined when none was left. */
export function takeDraftPrompt(draftID: string) {
  const prompt = prompts.get()[draftID]
  if (prompt === undefined) return undefined
  prompts.set((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== draftID)))
  return prompt
}
