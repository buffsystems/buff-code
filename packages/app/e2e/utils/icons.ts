import { expect, type Locator } from "@playwright/test"

/**
 * `scope` shows exactly one `glyph`: the Solid window's sprite symbol (`#opencode-v2-icon-<sprite>`)
 * or its lucide equivalent, which the React window draws (#584).
 */
export async function expectIcon(scope: Locator, glyph: { sprite: string; lucide: string }) {
  await expect(
    scope.locator(`:is(use[href="#opencode-v2-icon-${glyph.sprite}"], svg.lucide-${glyph.lucide})`),
  ).toHaveCount(1)
}
