export function filterVirtualIndexes(indexes: number[], count: number) {
  return indexes.filter((index) => index >= 0 && index < count)
}

// Rows holding a live text selection stay mounted while scrolling: unmounting one drops the selection.
export function selectedRowKeys(root: ParentNode, selection: Selection | null) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return []
  const range = selection.getRangeAt(0)
  return [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
    .filter((row) => range.intersectsNode(row))
    .map((row) => row.dataset.timelineKey!)
}

// Places the mounted rows, which lead their parent, in order. A row kept across a scroll stays
// attached unless its order changed: detaching it would drop a selection or focus inside it.
export function placeRowNodes(parent: Node, previous: readonly Node[], next: readonly Node[]) {
  const kept = new Set(next)
  previous.forEach((node) => {
    if (!kept.has(node)) node.parentNode?.removeChild(node)
  })
  const placed = new Map(previous.filter((node) => kept.has(node)).map((node, index) => [node, index] as const))
  let last = -1
  let anchor: Node | undefined
  next.forEach((node) => {
    const index = placed.get(node)
    if (index !== undefined && index > last) last = index
    if (index === undefined || index < last) parent.insertBefore(node, anchor ? anchor.nextSibling : parent.firstChild)
    anchor = node
  })
}
