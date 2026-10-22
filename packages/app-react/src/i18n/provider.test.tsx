import { expect, test } from "bun:test"
import { act } from "react"
import { render, settle } from "../test/render"
import { I18nProvider, preloadLanguage, useI18n } from "./provider"

const storage = (items: Map<string, string>) => ({
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => void items.set(key, value),
  removeItem: (key: string) => void items.delete(key),
})

test("starts in the stored language and persists a switch where the Solid window reads it", async () => {
  const items = new Map([["language", JSON.stringify({ locale: "ru" })]])
  const initial = await preloadLanguage(storage(items))
  const seen: { switch?: () => void } = {}
  function Probe() {
    const i18n = useI18n()
    seen.switch = () => i18n.setLocale("en")
    return <span>{i18n.t("ui.sessionReview.title")}</span>
  }
  const view = render(
    <I18nProvider storage={storage(items)} initial={initial}>
      <Probe />
    </I18nProvider>,
  )
  expect(view.element.textContent).toBe("Изменения сессии")
  act(() => seen.switch?.())
  await settle()
  expect(view.element.textContent).toBe("Session changes")
  expect(items.get("language")).toBe(JSON.stringify({ locale: "en" }))
  view.unmount()
})
