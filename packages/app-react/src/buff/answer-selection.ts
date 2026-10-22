// A selection wholly inside one answer — its text and where to show a button (#459, #464); copied
// from the Solid window's answer-quote.tsx, whose module is a Solid component.

export function answerSelection(selection: Selection | null, scope: string) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined
  const inside = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest(scope)
  const start = inside(selection.anchorNode)
  if (!start || start !== inside(selection.focusNode)) return undefined
  const text = selection.toString().trim()
  if (!text) return undefined
  return { text, rect: selection.getRangeAt(0).getBoundingClientRect() }
}
