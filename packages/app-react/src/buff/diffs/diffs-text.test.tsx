import { afterEach, expect, test } from "bun:test"
import { english } from "../../i18n/i18n"
import { I18nProvider } from "../../i18n/provider"
import { render, settle } from "../../test/render"
import { memoryStorage } from "../../test/storage"
import { DiffsText } from "./diffs-text"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

const text = (english: string, count?: number) =>
  (globalThis as { __buffDiffsText?: (text: string, count?: number) => string }).__buffDiffsText?.(english, count)

test("the diff viewer's own words follow the window's language, as in the Solid window (#470)", async () => {
  const view = render(
    <I18nProvider storage={memoryStorage()} initial={{ locale: "ru", dictionary: english }}>
      <DiffsText />
    </I18nProvider>,
  )
  cleanup.push(view.unmount)
  await settle()
  expect(text("{n} unmodified line|{n} unmodified lines", 8)).toBe("8 строк без изменений")
  expect(text("No newline at end of file")).not.toBe("No newline at end of file")
})
