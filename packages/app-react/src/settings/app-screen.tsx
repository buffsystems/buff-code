import { lazy } from "react"
import type { Screen } from "../router/screens"

// Settings open by a keybind from anywhere: their code starts loading with the window, so the
// first opening does not wait for it.
const screen = import("./screen")

export default {
  route: "settings",
  component: lazy(() => screen.then((module) => ({ default: module.SettingsScreen }))),
} satisfies Screen
