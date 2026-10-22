import { expect, type Page } from "@playwright/test"

/**
 * Store a light or dark choice for both windows (#584): the Solid window reads
 * `opencode-color-scheme`, the React window @buff/ui's `theme`.
 */
export async function storeColorScheme(page: Page, scheme: "light" | "dark") {
  await page.addInitScript((scheme) => {
    localStorage.setItem("opencode-color-scheme", scheme)
    localStorage.setItem("theme", scheme)
  }, scheme)
}

/**
 * The page paints `scheme`: `data-color-scheme` on <html> in the Solid window, @buff/ui's `.dark`
 * class (absent for light) in the React window.
 */
export async function expectColorScheme(page: Page, scheme: "light" | "dark") {
  const buff = scheme === "dark" ? ".dark" : ":not(.dark, [data-color-scheme])"
  await expect(page.locator(`html:is([data-color-scheme="${scheme}"], ${buff})`)).toHaveCount(1)
}
