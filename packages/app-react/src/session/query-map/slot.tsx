// The request map (#465) over the chat body, left of the timeline.

import { lazy } from "react"
import type { SessionSlot } from "../slots"

export default {
  slot: "chat-overlay",
  id: "query-map",
  component: lazy(() => import("./query-map").then((module) => ({ default: module.QueryMap }))),
} satisfies SessionSlot
