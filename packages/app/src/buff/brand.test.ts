// Имя продукта в интерфейсе десктопа — Buff Code (#398): переводы приходят от апстрима, и в
// каждом из ~50 языков десятки строк с «OpenCode». Подставляем при загрузке словаря.
import { expect, test } from "bun:test"
import { brandDictionary } from "./brand"

test("the product is named Buff Code in every string", () => {
  const dict = brandDictionary({
    "provider.connect.oauth.code.visit.suffix": " and enter the code below to use {{provider}} models in OpenCode.",
    "app.name.desktop": "OpenCode Desktop",
    "toast.update.description": "A new version of OpenCode ({{version}}) is now available to install.",
    "server.connect.scan.invalid": "This is not an OpenCode pairing code. Scan the code shown by opencode pair.",
    "settings.general.row.theme.description": "Настройте, как выглядит OpenCode.",
  })
  expect(dict["provider.connect.oauth.code.visit.suffix"]).toBe(
    " and enter the code below to use {{provider}} models in Buff Code.",
  )
  expect(dict["app.name.desktop"]).toBe("Buff Code")
  expect(dict["toast.update.description"]).toContain("Buff Code ({{version}})")
  expect(dict["server.connect.scan.invalid"]).toBe(
    "This is not a Buff Code pairing code. Scan the code shown by buff pair.",
  )
  expect(dict["settings.general.row.theme.description"]).toBe("Настройте, как выглядит Buff Code.")
})

test("the trademark notice stays as it is — it is about OpenCode, not about us", () => {
  const notice = "OpenCode is a registered trademark of Anomaly Innovations, Inc."
  expect(brandDictionary({ "settings.about.trademark": notice })["settings.about.trademark"]).toBe(notice)
})

test("a dictionary with a missing value does not break the window (#469)", () => {
  const dict = brandDictionary({ "app.name.desktop": "OpenCode Desktop", "some.key": undefined } as unknown as Record<
    string,
    string
  >)
  expect(dict["app.name.desktop"]).toBe("Buff Code")
  expect(dict["some.key"]).toBeUndefined()
})
