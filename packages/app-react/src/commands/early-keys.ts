// Keybinds pressed while the window is still mounting (#584): the React window renders after its
// language has loaded, a moment after the page itself, so a shortcut pressed right away (Ctrl+,
// on opening) would reach no listener. Shortcuts with a modifier are kept until the command
// registry attaches and are then handled as if they had just been pressed.

const kept: KeyboardEvent[] = []
const state = { listening: false }

function keep(event: KeyboardEvent) {
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return
  kept.push(event)
}

if (typeof document !== "undefined") {
  state.listening = true
  document.addEventListener("keydown", keep, { capture: true })
}

/** The shortcuts pressed before the registry attached; stops keeping them. */
export function takeEarlyKeys() {
  if (state.listening) document.removeEventListener("keydown", keep, { capture: true })
  state.listening = false
  return kept.splice(0)
}
