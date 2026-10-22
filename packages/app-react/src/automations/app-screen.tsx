import { lazy } from "react"
import type { Screen } from "../router/screens"

export default {
  route: "automations",
  component: lazy(() => import("./page").then((module) => ({ default: module.AutomationsScreen }))),
} satisfies Screen
