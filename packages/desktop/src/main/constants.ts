import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"

const appNames: Record<string, string> = {
  dev: "Buff Code Dev",
  beta: "Buff Code Beta",
  prod: "Buff Code",
}
const appIDs: Record<string, string> = {
  dev: "systems.buff.code.dev",
  beta: "systems.buff.code.beta",
  prod: "systems.buff.code",
}
// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "Buff Code Dev"
export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "systems.buff.code.dev"
