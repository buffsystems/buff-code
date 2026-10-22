// Focus a terminal by its PTY id (#584): its textarea when ghostty mounted one, else the screen.

export function focusTerminalById(id: string) {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false
  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus({ preventScroll: true })
    return true
  }
  terminal.focus({ preventScroll: true })
  terminal.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
  return true
}
