// One sound and one system notification per event across the window's tabs and windows (#584),
// the Solid notification coordinator without Solid: an event is claimed in localStorage under a
// Web Lock, and a system notification goes out only from an unfocused window, once.

const FOCUS_LOCK = "opencode:notification-focus"
const MAX_CLAIMED = 500

type Kind = "sound" | "system"

/** Claim an event for this renderer; false when it was claimed here or by another window. */
export function claimNotification(kind: Kind, eventID: string, claimed: Set<string>, storage?: Storage) {
  if (claimed.has(eventID)) return false
  try {
    const key = `opencode:notification-${kind}`
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "[]")
    const events = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
    if (events.includes(eventID)) {
      claimed.add(eventID)
      return false
    }
    storage?.setItem(key, JSON.stringify([...events, eventID].slice(-MAX_CLAIMED)))
  } catch {
    // The in-memory claim still prevents duplicates in this renderer when storage is unavailable.
  }
  claimed.add(eventID)
  return true
}

export function createNotificationCoordinator() {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  const storage = typeof localStorage === "undefined" ? undefined : localStorage
  const claimed = new Set<string>()
  const focus = { pending: false, release: undefined as (() => void) | undefined }

  // A focused window holds the shared focus lock: an exclusive request succeeds only when none does.
  const updateFocus = () => {
    if (!document.hasFocus()) return focus.release?.()
    if (!locks || focus.pending || focus.release) return
    focus.pending = true
    void locks
      .request(FOCUS_LOCK, { mode: "shared" }, async () => {
        focus.pending = false
        if (!document.hasFocus()) return
        await new Promise<void>((resolve) => {
          focus.release = resolve
        })
        focus.release = undefined
      })
      .catch(() => {
        focus.pending = false
      })
  }
  window.addEventListener("focus", updateFocus)
  window.addEventListener("blur", updateFocus)
  document.addEventListener("visibilitychange", updateFocus)
  updateFocus()

  const once = async (kind: Kind, eventID: string, run: () => Promise<unknown> | void) => {
    const key = `${kind}:${eventID}`
    const execute = async () => {
      if (!claimNotification(kind, key, claimed, storage)) return
      await run()
    }
    if (!locks) return execute()
    await locks.request(`opencode:notification:${key}`, execute)
  }

  return {
    sound: (eventID: string, run: () => Promise<unknown> | void) => once("sound", eventID, run),
    system: (eventID: string, run: () => Promise<unknown> | void) =>
      once("system", eventID, async () => {
        if (document.hasFocus()) return
        if (!locks) return run()
        await locks.request(FOCUS_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (lock) await run()
        })
      }),
    dispose() {
      window.removeEventListener("focus", updateFocus)
      window.removeEventListener("blur", updateFocus)
      document.removeEventListener("visibilitychange", updateFocus)
      focus.release?.()
    },
  }
}

export type NotificationCoordinator = ReturnType<typeof createNotificationCoordinator>
