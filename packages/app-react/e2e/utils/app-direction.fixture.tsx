// The React window's counterpart of packages/app/e2e/utils/app-direction.fixture.tsx (#584): the
// window opened on a route in a given writing direction. The window itself only ships left-to-right
// languages and writes `dir="ltr"` when its language loads, so the fixture keeps the requested
// direction on the document.

import "../../src/index.css"
import { mountApp } from "../../src/mount"
import { createWebPlatform } from "../../src/platform/web"

export function mount(input: { server: string; route: string; direction: "ltr" | "rtl" }) {
  const root = document.getElementById("root")
  if (!root) throw new Error("Missing fixture root")
  const html = document.documentElement
  const hold = () => {
    if (html.dir !== input.direction) html.dir = input.direction
  }
  hold()
  new MutationObserver(hold).observe(html, { attributes: true, attributeFilter: ["dir"] })
  const web = createWebPlatform("test")
  const server = { type: "http" as const, http: { url: input.server } }
  mountApp(root, {
    platform: web.platform,
    servers: [server],
    defaultServer: input.server,
    canonicalLocalServer: input.server,
    history: { type: "memory", initialUrl: input.route },
  })
}
