import type { History } from "./history"

/**
 * Same-origin anchors anywhere in the document navigate inside the window, as the Solid window's
 * router delegates them: rendered markdown links, fixtures and plain `<a href>` alike — without
 * it a click reloads the whole page. Modified or non-primary clicks, targeted, download and
 * `rel="external"` anchors, other origins and clicks a handler already took stay native.
 */
export function delegateLinks(history: History) {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement)
    if (!anchor || anchor.target || !anchor.href || anchor.hasAttribute("download")) return
    if ((anchor.getAttribute("rel") ?? "").split(/\s+/).includes("external")) return
    const url = new URL(anchor.href)
    if (url.origin !== window.location.origin) return
    event.preventDefault()
    history.navigate(url.pathname + url.search + url.hash, { replace: anchor.hasAttribute("replace") })
  }
  document.addEventListener("click", onClick)
  return () => document.removeEventListener("click", onClick)
}
