// SSH hosts' prompts and background reconnects live for the whole window (#584).

import { lazy } from "react"
import type { AppMount } from "../shell/mounts"

export default {
  id: "servers-ssh",
  component: lazy(() => import("./ssh/background").then((module) => ({ default: module.SshBackground }))),
} satisfies AppMount
