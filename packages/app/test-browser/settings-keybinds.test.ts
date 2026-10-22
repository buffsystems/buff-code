import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createKeybindSettingsController } from "../src/settings/keybinds/keybinds"

// Buff (#460): занятое сочетание и сброс — только после подтверждения; ответ задаёт тест.
function setup(overrides: Record<string, string> = {}, answer = true) {
  const asked: string[] = []
  const changes: [string, string][] = []
  const suppression: boolean[] = []
  const notifications: { title: string; description?: string }[] = []
  let resets = 0
  let controller: ReturnType<typeof createKeybindSettingsController>

  const dispose = createRoot((dispose) => {
    controller = createKeybindSettingsController(
      {
        command: {
          catalog: [
            { id: "session.alpha", title: "Alpha", keybind: "mod+a" },
            { id: "session.beta", title: "Beta", keybind: "mod+b" },
          ],
          options: [],
          keybinds: (enabled) => suppression.push(enabled),
        },
        settings: {
          current: { keybinds: overrides },
          keybinds: {
            get: (id) => overrides[id],
            set: (id, value) => {
              overrides[id] = value
              changes.push([id, value])
            },
            resetAll: () => {
              resets++
            },
          },
        },
        notify: (toast) => notifications.push(toast),
        confirm: async (ask) => {
          asked.push(ask.title)
          return answer
        },
      },
      {
        locale: () => "en",
        t: (key, params) => {
          if (params) return `${key}:${Object.values(params).join("|")}`
          if (key === "common.key.alt") return "Alt"
          return String(key)
        },
      },
    )
    return dispose
  })

  return {
    controller: controller!,
    changes,
    suppression,
    notifications,
    resets: () => resets,
    asked,
    dispose,
  }
}

function modKey(key: string) {
  const mac = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)
  return new KeyboardEvent("keydown", { key, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true })
}

describe("keybind settings controller", () => {
  test("derives the catalog, effective bindings, and filtered groups", () => {
    const state = setup({ "session.beta": "alt+k" })

    expect(state.controller.catalog.title("session.alpha")).toBe("Alpha")
    expect(state.controller.catalog.keybind("session.beta")).toBe("Alt+K")
    expect(state.controller.catalog.filtered("alt k").get("Session")).toEqual(["session.beta"])
    expect(state.controller.settings.hasOverrides()).toBe(true)

    state.dispose()
  })

  test("captures bindings, asks before taking a used one, and restores command handling", async () => {
    const state = setup({}, false)

    state.controller.capture.toggle("session.beta")
    document.dispatchEvent(modKey("a"))
    await Promise.resolve()
    expect(state.asked).toEqual(["Keys taken"])
    expect(state.changes).toEqual([])
    expect(state.suppression).toEqual([false, true])
    expect(state.controller.capture.active()).toBeNull()

    state.controller.capture.toggle("session.beta")
    document.dispatchEvent(modKey("x"))
    expect(state.changes).toEqual([["session.beta", "mod+x"]])
    expect(state.suppression).toEqual([false, true, false, true])
    expect(state.controller.capture.active()).toBeNull()

    state.controller.capture.toggle("session.alpha")
    state.dispose()
    expect(state.suppression).toEqual([false, true, false, true, false, true])
    document.dispatchEvent(modKey("z"))
    expect(state.changes).toEqual([["session.beta", "mod+x"]])
  })

  test("resets persisted overrides after a yes and reports success", async () => {
    const state = setup({ "session.alpha": "none" })

    state.controller.settings.reset()
    await Promise.resolve()
    expect(state.asked).toEqual(["Reset all key bindings?"])
    expect(state.resets()).toBe(1)
    expect(state.notifications[0]?.title).toBe("settings.shortcuts.reset.toast.title")

    state.dispose()
  })
})
