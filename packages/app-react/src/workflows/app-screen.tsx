import { lazy } from "react"
import type { Screen } from "../router/screens"

export default {
  route: "workflows",
  component: lazy(() => import("./page").then((module) => ({ default: module.WorkflowsScreen }))),
} satisfies Screen
