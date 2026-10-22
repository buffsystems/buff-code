// Screens other features contribute (#584): a folder adds `src/<folder>/app-screen.tsx` whose default
// export names its route and component (lazy-load the real screen), and the window routes to it —
// no edit to app.tsx. Home, the draft and the session screen are routed by the shell itself.

import type { ComponentType } from "react"
import type { Route } from "./routes"

export type ScreenRoute = Exclude<Route["name"], "home" | "session" | "new-session" | "not-found">
export type Screen = { route: ScreenRoute; component: ComponentType }

const found = (): Record<string, { default: Screen }> => {
  try {
    return import.meta.glob<{ default: Screen }>("../*/app-screen.tsx", { eager: true })
  } catch {
    return {}
  }
}

export const registeredScreens: Partial<Record<ScreenRoute, ComponentType>> = Object.fromEntries(
  Object.values(found()).map((module) => [module.default.route, module.default.component]),
)
