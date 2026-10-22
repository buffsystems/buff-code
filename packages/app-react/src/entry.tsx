// Safari before 17.4 lacks Map.groupBy and Promise.withResolvers; the Solid web entry loads these too.
import "@opencode/app/react-reuse/polyfills"
import "./index.css"
import { authFromToken } from "@opencode/app/react-reuse/server-api"
import pkg from "../package.json"
import { mountApp } from "./mount"
import { createWebPlatform } from "./platform/web"

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")

// A shared link may carry the server's credential once; it is taken and dropped from the address.
const params = new URLSearchParams(location.search)
const auth = authFromToken(params.get("auth_token"))
if (params.has("auth_token")) {
  params.delete("auth_token")
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash)
}

const web = createWebPlatform(pkg.version)
const servers = web.currentServerUrl
  ? [{ type: "http" as const, authToken: !!auth, http: { url: web.currentServerUrl, ...auth } }]
  : []
mountApp(root, {
  platform: web.platform,
  servers,
  defaultServer: web.defaultServerUrl ?? undefined,
  canonicalLocalServer: web.currentServerUrl,
  history: { type: "browser" },
})
