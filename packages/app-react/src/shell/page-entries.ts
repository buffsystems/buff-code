// Buff's own pages reached from the shell (#447, #448): automations and workflows.

import { Repeat, Workflow, type LucideIcon } from "lucide-react"

export type PageEntry = {
  path: "/automations" | "/workflows"
  route: "automations" | "workflows"
  /** English source; translated through BuffI18n. */
  title: string
  icon: LucideIcon
  action: string
}

export const PAGE_ENTRIES: readonly PageEntry[] = [
  { path: "/automations", route: "automations", title: "Automations", icon: Repeat, action: "buff-automations" },
  { path: "/workflows", route: "workflows", title: "Workflows", icon: Workflow, action: "buff-workflows" },
]
