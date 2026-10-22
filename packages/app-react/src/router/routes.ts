// The window's routes (#584), as the Solid window's routes.tsx defines them: Home, settings,
// automations, workflows, a draft session and a server's session.

import { base64Decode, base64Encode } from "@opencode/util/encode"

export type Route =
  | { name: "home" }
  | { name: "settings" }
  | { name: "automations" }
  | { name: "workflows" }
  | { name: "new-session" }
  | { name: "session"; serverKey: string; sessionID: string }
  | { name: "not-found"; pathname: string }

const fixed: Record<string, Route> = {
  "/": { name: "home" },
  "/settings": { name: "settings" },
  "/automations": { name: "automations" },
  "/workflows": { name: "workflows" },
  "/new-session": { name: "new-session" },
}

export function matchRoute(pathname: string): Route {
  const known = fixed[pathname]
  if (known) return known
  const session = /^\/server\/([^/]+)\/session\/([^/]+)$/.exec(pathname)
  const serverKey = session?.[1] ? decodeServerKey(session[1]) : undefined
  if (session?.[2] && serverKey) return { name: "session", serverKey, sessionID: session[2] }
  return { name: "not-found", pathname }
}

export function sessionHref(serverKey: string, sessionID: string) {
  return `/server/${base64Encode(serverKey)}/session/${sessionID}`
}

// Only the canonical encoding of a key is a valid segment, as in the Solid window.
function decodeServerKey(segment: string) {
  try {
    const key = base64Decode(segment)
    return key && base64Encode(key) === segment ? key : undefined
  } catch {
    return undefined
  }
}
