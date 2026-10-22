// Buff (#561): the window is the React rewrite (react.html); the Solid renderer (index.html) is no
// longer built into the desktop app. The old window choice (BUFF_UI, the stored "buffUi") is
// ignored.
export function currentRendererPage() {
  return "react.html"
}
