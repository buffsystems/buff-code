// Where focus goes when the thing that had it leaves the screen (#972: R2-30, R23-02). A removed
// chip, an answered request — the browser drops focus to the page, and a keyboard is lost. It goes
// to the message box of the same session: several sessions stay mounted, so the box is looked for
// upwards from where the person was, not across the page.

const BOX = '[data-component="composer-editor"]'

/** The message box nearest to `from` — in the same session view. */
export function nearestBox(from: Element | null): HTMLElement | null {
  for (let at = from?.parentElement ?? null; at; at = at.parentElement) {
    const box = at.querySelector<HTMLElement>(BOX)
    if (box) return box
  }
  return null
}

/** Whether focus was dropped: nothing holds it, or what held it is gone from the page. */
export function focusLost(doc: Document = document): boolean {
  const active = doc.activeElement
  return !active || active === doc.body || !active.isConnected
}
