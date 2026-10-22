// Горячие клавиши (#460): без модификатора — нет и причина в строке; занято и сброс — с подтверждением.
import { afterEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createKeybindSettingsController } from "@/settings/keybinds/keybinds"

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

function setup(answer: boolean) {
  const saved: Record<string, string> = {}
  const asked: string[] = []
  let resets = 0
  const language = { locale: () => "ru", t: (key: string) => key } as never
  const commands = [
    { id: "session.new", title: "Новая сессия", keybind: "mod+n" },
    { id: "file.open", title: "Открыть файл", keybind: "mod+p" },
  ]
  return createRoot((dispose) => {
    disposers.push(dispose)
    const controller = createKeybindSettingsController(
      {
        command: { catalog: commands, options: commands, keybinds: () => undefined } as never,
        settings: {
          current: { keybinds: saved },
          keybinds: {
            get: (id: string) => saved[id],
            set: (id: string, value: string) => void (saved[id] = value),
            resetAll: () => void (resets += 1),
          },
        } as never,
        target: document,
        notify: () => undefined,
        confirm: async (ask) => {
          asked.push(ask.title)
          return answer
        },
      },
      language,
    )
    return { controller, saved, asked, resets: () => resets }
  })
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("a key without a modifier is refused and the reason is shown in the row", () => {
  const { controller, saved } = setup(true)
  controller.capture.toggle("session.new")
  press("k")
  expect(saved["session.new"]).toBeUndefined()
  expect(controller.catalog.problem("session.new")).toContain("Нужен модификатор")
  expect(controller.capture.active()).toBe("session.new")
})

test("taken keys are reassigned only after a yes; the other command loses them", async () => {
  const yes = setup(true)
  yes.controller.capture.toggle("session.new")
  press("p", { ctrlKey: true })
  await tick()
  expect(yes.asked).toEqual(["Сочетание занято"])
  expect(yes.saved).toEqual({ "file.open": "none", "session.new": "mod+p" })

  const no = setup(false)
  no.controller.capture.toggle("session.new")
  press("p", { ctrlKey: true })
  await tick()
  expect(no.saved).toEqual({})
})

test("reset asks first", async () => {
  const no = setup(false)
  no.controller.settings.reset()
  await tick()
  expect(no.asked).toEqual(["Сбросить все сочетания?"])
  expect(no.resets()).toBe(0)
  const yes = setup(true)
  yes.controller.settings.reset()
  await tick()
  expect(yes.resets()).toBe(1)
})

test("the commands sharing keys are named; search by pressed keys finds them", () => {
  const { controller } = setup(true)
  expect(controller.catalog.alsoOn("session.new")).toEqual([])
  controller.catalog.combo.start()
  press("p", { ctrlKey: true })
  const found = [...controller.catalog.filtered("").values()].flat()
  expect(found).toEqual(["file.open"])
})
