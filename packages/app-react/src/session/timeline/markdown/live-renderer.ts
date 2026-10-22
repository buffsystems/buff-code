// The live markdown renderer (#584): the Solid window's markdown-solid in plain DOM. A streaming
// block's HTML is parsed into keyed nodes and patched in place, so words already on screen keep
// their elements and only new words enter (and animate).

type MarkdownNode =
  | {
      key: string
      type: "element"
      tag: string
      attributes: Record<string, string>
      children: MarkdownNode[]
      animate?: true
    }
  | { key: string; type: "text"; text: string }
  | { key: string; type: "word"; text: string; animate?: true }

type Rendered = { node: MarkdownNode; dom: Node; children: Rendered[] }

export function createMarkdownRenderer(root: HTMLDivElement, html: string, words: boolean) {
  const state = { ready: false, rendered: [] as Rendered[] }
  state.rendered = patchChildren(root, [], parseMarkdownNodes(html, words), state)
  state.ready = true
  return {
    update(next: string, nextWords: boolean, animate = true) {
      state.rendered = patchChildren(root, state.rendered, parseMarkdownNodes(next, nextWords, animate), state)
    },
    dispose() {
      state.rendered = []
    },
  }
}

export function parseMarkdownNodes(html: string, words: boolean, animate = false) {
  const template = document.createElement("template")
  template.innerHTML = html
  return Array.from(template.content.childNodes).flatMap((node, index) => parseNode(node, `${index}`, words, animate))
}

function parseNode(node: Node, key: string, words: boolean, animate: boolean, inlineCode = false): MarkdownNode[] {
  if (node instanceof Text) {
    if (!words) return [{ key, type: "text", text: node.data }]
    return (inlineCode ? Array.from(node.data) : node.data.split(/(\s+)/)).flatMap((text, index): MarkdownNode[] => {
      if (!text) return []
      if (/^\s+$/.test(text)) return [{ key: `${key}:${index}`, type: "text", text }]
      return [{ key: `${key}:${index}`, type: "word", text, ...(animate ? { animate: true as const } : {}) }]
    })
  }
  if (!(node instanceof Element)) return []
  const code = node.tagName === "CODE" && node.parentElement?.tagName !== "PRE"
  return [
    {
      key,
      type: "element",
      tag: node.tagName.toLowerCase(),
      attributes: Object.fromEntries(Array.from(node.attributes).map((attribute) => [attribute.name, attribute.value])),
      children: Array.from(node.childNodes).flatMap((child, index) =>
        parseNode(child, `${key}.${index}`, words, animate, inlineCode || code),
      ),
      ...(words && animate && code ? { animate: true as const } : {}),
    },
  ]
}

// Keyed like Solid's reconcile + For: a node keeps its DOM while its key and kind stay the same.
function patchChildren(parent: Node, previous: Rendered[], next: MarkdownNode[], state: { ready: boolean }) {
  const byKey = new Map(previous.map((item) => [item.node.key, item] as const))
  const rendered = next.map((node) => {
    const existing = byKey.get(node.key)
    if (existing && sameKind(existing.node, node)) {
      byKey.delete(node.key)
      return update(existing, node, state)
    }
    return create(node, state)
  })
  byKey.forEach((item) => item.dom.parentNode?.removeChild(item.dom))
  rendered.forEach((item, index) => {
    const at = parent.childNodes[index]
    if (at !== item.dom) parent.insertBefore(item.dom, at ?? null)
  })
  while (parent.childNodes.length > rendered.length) parent.lastChild?.remove()
  return rendered
}

function sameKind(a: MarkdownNode, b: MarkdownNode) {
  if (a.type !== b.type) return false
  return a.type !== "element" || (b.type === "element" && a.tag === b.tag)
}

function create(node: MarkdownNode, state: { ready: boolean }): Rendered {
  if (node.type === "text") return { node, dom: document.createTextNode(node.text), children: [] }
  if (node.type === "word") {
    const span = document.createElement("span")
    span.setAttribute("data-markdown-word", "")
    span.textContent = node.text
    if (state.ready && node.animate) span.setAttribute("data-markdown-enter", "")
    return { node, dom: span, children: [] }
  }
  const element = document.createElement(node.tag)
  Object.entries(node.attributes).forEach(([name, value]) => element.setAttribute(name, value))
  if (state.ready && node.animate) element.setAttribute("data-markdown-enter", "")
  return { node, dom: element, children: patchChildren(element, [], node.children, state) }
}

function update(item: Rendered, node: MarkdownNode, state: { ready: boolean }): Rendered {
  if (node.type === "text" || node.type === "word") {
    const target = node.type === "text" ? item.dom : item.dom.firstChild
    if (target && target.textContent !== node.text) target.textContent = node.text
    if (node.type === "word" && !item.dom.firstChild) item.dom.textContent = node.text
    return { node, dom: item.dom, children: [] }
  }
  const element = item.dom
  if (!(element instanceof Element) || item.node.type !== "element") return create(node, state)
  const before = item.node.attributes
  Object.keys(before).forEach((name) => {
    if (!(name in node.attributes)) element.removeAttribute(name)
  })
  Object.entries(node.attributes).forEach(([name, value]) => {
    if (before[name] !== value) element.setAttribute(name, value)
  })
  return { node, dom: element, children: patchChildren(element, item.children, node.children, state) }
}
